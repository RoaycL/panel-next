package weather

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	defaultGeocodingURL = "https://geocoding-api.open-meteo.com/v1/search"
	defaultForecastURL  = "https://api.open-meteo.com/v1/forecast"
	maxResponseBytes    = 1 << 20
	maxCacheEntries     = 512
	forecastDays        = 10
	hourlyHours         = 24
)

var (
	ErrInvalidCity      = errors.New("invalid city")
	ErrInvalidUnits     = errors.New("invalid units")
	ErrLocationNotFound = errors.New("location not found")
)

type Location struct {
	Name      string  `json:"name"`
	Admin1    string  `json:"admin1,omitempty"`
	Country   string  `json:"country,omitempty"`
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Timezone  string  `json:"timezone,omitempty"`
}

type Current struct {
	Time                string  `json:"time"`
	Temperature         float64 `json:"temperature"`
	ApparentTemperature float64 `json:"apparentTemperature"`
	RelativeHumidity    int     `json:"relativeHumidity"`
	WeatherCode         int     `json:"weatherCode"`
	WindSpeed           float64 `json:"windSpeed"`
	IsDay               bool    `json:"isDay"`
	TemperatureUnit     string  `json:"temperatureUnit"`
	WindSpeedUnit       string  `json:"windSpeedUnit"`
	WindDirection       float64 `json:"windDirection"`
	Pressure            float64 `json:"pressure"`
	Visibility          float64 `json:"visibility"`
	VisibilityUnit      string  `json:"visibilityUnit,omitempty"`
	UVIndex             float64 `json:"uvIndex"`
	Precipitation       float64 `json:"precipitation"`
	PrecipitationUnit   string  `json:"precipitationUnit,omitempty"`
	DewPoint            float64 `json:"dewPoint"`
}

type Hourly struct {
	Time                     string  `json:"time"`
	Temperature              float64 `json:"temperature"`
	WeatherCode              int     `json:"weatherCode"`
	IsDay                    bool    `json:"isDay"`
	PrecipitationProbability int     `json:"precipitationProbability"`
}

type Daily struct {
	Date                     string  `json:"date"`
	WeatherCode              int     `json:"weatherCode"`
	TemperatureMax           float64 `json:"temperatureMax"`
	TemperatureMin           float64 `json:"temperatureMin"`
	Sunrise                  string  `json:"sunrise,omitempty"`
	Sunset                   string  `json:"sunset,omitempty"`
	UVIndexMax               float64 `json:"uvIndexMax"`
	PrecipitationProbability int     `json:"precipitationProbability"`
}

type Result struct {
	Location  Location  `json:"location"`
	Current   Current   `json:"current"`
	Hourly    []Hourly  `json:"hourly,omitempty"`
	Daily     []Daily   `json:"daily,omitempty"`
	Units     string    `json:"units"`
	FetchedAt time.Time `json:"fetchedAt"`
	Cached    bool      `json:"cached"`
	Stale     bool      `json:"stale"`
}

type cacheEntry struct {
	result     Result
	expiresAt  time.Time
	staleUntil time.Time
}

type Client struct {
	httpClient   *http.Client
	geocodingURL string
	forecastURL  string
	ttl          time.Duration
	staleTTL     time.Duration
	now          func() time.Time

	mu    sync.Mutex
	cache map[string]cacheEntry
}

func NewClient(httpClient *http.Client, geocodingURL, forecastURL string, ttl, staleTTL time.Duration) *Client {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 5 * time.Second}
	}
	return &Client{
		httpClient:   httpClient,
		geocodingURL: strings.TrimRight(geocodingURL, "/"),
		forecastURL:  strings.TrimRight(forecastURL, "/"),
		ttl:          ttl,
		staleTTL:     staleTTL,
		now:          time.Now,
		cache:        make(map[string]cacheEntry),
	}
}

var DefaultClient = NewClient(
	&http.Client{Timeout: 5 * time.Second},
	defaultGeocodingURL,
	defaultForecastURL,
	10*time.Minute,
	6*time.Hour,
)

func (client *Client) Get(ctx context.Context, city, units, language string) (Result, error) {
	city = strings.TrimSpace(city)
	if utf8.RuneCountInString(city) < 2 || utf8.RuneCountInString(city) > 80 {
		return Result{}, ErrInvalidCity
	}
	if units != "metric" && units != "imperial" {
		return Result{}, ErrInvalidUnits
	}
	language = normalizeLanguage(language)
	key := strings.ToLower(city) + "\x00" + units + "\x00" + language
	now := client.now()

	client.mu.Lock()
	entry, found := client.cache[key]
	client.mu.Unlock()
	if found && now.Before(entry.expiresAt) {
		entry.result.Cached = true
		return entry.result, nil
	}

	result, err := client.fetch(ctx, city, units, language)
	if err != nil {
		if found && now.Before(entry.staleUntil) {
			entry.result.Cached = true
			entry.result.Stale = true
			return entry.result, nil
		}
		return Result{}, err
	}
	result.FetchedAt = now.UTC()
	client.mu.Lock()
	client.pruneCacheLocked(now)
	client.cache[key] = cacheEntry{
		result: result, expiresAt: now.Add(client.ttl), staleUntil: now.Add(client.staleTTL),
	}
	client.mu.Unlock()
	return result, nil
}

func (client *Client) pruneCacheLocked(now time.Time) {
	for key, candidate := range client.cache {
		if !now.Before(candidate.staleUntil) {
			delete(client.cache, key)
		}
	}
	for len(client.cache) >= maxCacheEntries {
		for key := range client.cache {
			delete(client.cache, key)
			break
		}
	}
}

func normalizeLanguage(language string) string {
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(language)), "zh") {
		return "zh"
	}
	return "en"
}

func (client *Client) fetch(ctx context.Context, city, units, language string) (Result, error) {
	location, err := client.geocode(ctx, city, language)
	if err != nil {
		return Result{}, err
	}
	current, hourly, daily, err := client.forecast(ctx, location, units)
	if err != nil {
		return Result{}, err
	}
	return Result{Location: location, Current: current, Hourly: hourly, Daily: daily, Units: units}, nil
}

func containsHan(s string) bool {
	for _, r := range s {
		if unicode.Is(unicode.Han, r) {
			return true
		}
	}
	return false
}

func (client *Client) geocode(ctx context.Context, city, language string) (Location, error) {
	lang := language
	if containsHan(city) {
		lang = "zh"
	}

	loc, err := client.doGeocode(ctx, city, lang)
	if err == nil {
		return loc, nil
	}

	if lang != "" {
		if fallbackLoc, fallbackErr := client.doGeocode(ctx, city, ""); fallbackErr == nil {
			return fallbackLoc, nil
		}
	}
	return Location{}, err
}

func (client *Client) doGeocode(ctx context.Context, city, language string) (Location, error) {
	query := url.Values{
		"name":   {city},
		"count":  {"1"},
		"format": {"json"},
	}
	if language != "" {
		query.Set("language", language)
	}
	var response struct {
		Results []Location `json:"results"`
	}
	if err := client.getJSON(ctx, client.geocodingURL+"?"+query.Encode(), &response); err != nil {
		return Location{}, fmt.Errorf("geocoding request: %w", err)
	}
	if len(response.Results) == 0 {
		return Location{}, ErrLocationNotFound
	}
	return response.Results[0], nil
}

func (client *Client) forecast(ctx context.Context, location Location, units string) (Current, []Hourly, []Daily, error) {
	query := url.Values{
		"latitude":      {fmt.Sprintf("%.6f", location.Latitude)},
		"longitude":     {fmt.Sprintf("%.6f", location.Longitude)},
		"current":       {"temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,wind_direction_10m,pressure_msl,visibility,uv_index,precipitation,dew_point_2m"},
		"hourly":        {"temperature_2m,weather_code,is_day,precipitation_probability"},
		"daily":         {"weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max"},
		"forecast_days": {strconv.Itoa(forecastDays)},
		"timezone":      {"auto"},
	}
	if units == "imperial" {
		query.Set("temperature_unit", "fahrenheit")
		query.Set("wind_speed_unit", "mph")
		query.Set("precipitation_unit", "inch")
	}
	var response struct {
		Current struct {
			Time                string  `json:"time"`
			Temperature         float64 `json:"temperature_2m"`
			ApparentTemperature float64 `json:"apparent_temperature"`
			RelativeHumidity    int     `json:"relative_humidity_2m"`
			WeatherCode         int     `json:"weather_code"`
			WindSpeed           float64 `json:"wind_speed_10m"`
			WindDirection       float64 `json:"wind_direction_10m"`
			Pressure            float64 `json:"pressure_msl"`
			Visibility          float64 `json:"visibility"`
			UVIndex             float64 `json:"uv_index"`
			Precipitation       float64 `json:"precipitation"`
			DewPoint            float64 `json:"dew_point_2m"`
			IsDay               int     `json:"is_day"`
		} `json:"current"`
		CurrentUnits struct {
			Temperature   string `json:"temperature_2m"`
			WindSpeed     string `json:"wind_speed_10m"`
			Visibility    string `json:"visibility"`
			Precipitation string `json:"precipitation"`
		} `json:"current_units"`
		Hourly struct {
			Time                     []string   `json:"time"`
			Temperature              []float64  `json:"temperature_2m"`
			WeatherCode              []int      `json:"weather_code"`
			IsDay                    []int      `json:"is_day"`
			PrecipitationProbability []*float64 `json:"precipitation_probability"`
		} `json:"hourly"`
		Daily struct {
			Time                     []string   `json:"time"`
			WeatherCode              []int      `json:"weather_code"`
			TemperatureMax           []float64  `json:"temperature_2m_max"`
			TemperatureMin           []float64  `json:"temperature_2m_min"`
			Sunrise                  []string   `json:"sunrise"`
			Sunset                   []string   `json:"sunset"`
			UVIndexMax               []*float64 `json:"uv_index_max"`
			PrecipitationProbability []*float64 `json:"precipitation_probability_max"`
		} `json:"daily"`
	}
	if err := client.getJSON(ctx, client.forecastURL+"?"+query.Encode(), &response); err != nil {
		return Current{}, nil, nil, fmt.Errorf("forecast request: %w", err)
	}
	if response.Current.Time == "" || response.CurrentUnits.Temperature == "" || response.CurrentUnits.WindSpeed == "" {
		return Current{}, nil, nil, errors.New("forecast response is incomplete")
	}
	var daily []Daily
	if count := len(response.Daily.Time); count > 0 && count <= forecastDays && len(response.Daily.WeatherCode) == count && len(response.Daily.TemperatureMax) == count && len(response.Daily.TemperatureMin) == count {
		candidate := make([]Daily, 0, count)
		for index, date := range response.Daily.Time {
			if _, err := time.Parse("2006-01-02", date); err != nil {
				candidate = nil
				break
			}
			candidate = append(candidate, Daily{
				Date: date, WeatherCode: response.Daily.WeatherCode[index],
				TemperatureMax: response.Daily.TemperatureMax[index], TemperatureMin: response.Daily.TemperatureMin[index],
				Sunrise: stringAt(response.Daily.Sunrise, index), Sunset: stringAt(response.Daily.Sunset, index),
				UVIndexMax:               floatAt(response.Daily.UVIndexMax, index),
				PrecipitationProbability: int(math.Round(floatAt(response.Daily.PrecipitationProbability, index))),
			})
		}
		daily = candidate
	}
	return Current{
		Time: response.Current.Time, Temperature: response.Current.Temperature,
		ApparentTemperature: response.Current.ApparentTemperature,
		RelativeHumidity:    response.Current.RelativeHumidity, WeatherCode: response.Current.WeatherCode,
		WindSpeed: response.Current.WindSpeed, IsDay: response.Current.IsDay == 1,
		TemperatureUnit: response.CurrentUnits.Temperature, WindSpeedUnit: response.CurrentUnits.WindSpeed,
		WindDirection: response.Current.WindDirection, Pressure: response.Current.Pressure,
		Visibility: response.Current.Visibility, VisibilityUnit: response.CurrentUnits.Visibility,
		UVIndex: response.Current.UVIndex, Precipitation: response.Current.Precipitation,
		PrecipitationUnit: response.CurrentUnits.Precipitation, DewPoint: response.Current.DewPoint,
	}, upcomingHours(response.Current.Time, response.Hourly.Time, response.Hourly.Temperature, response.Hourly.WeatherCode, response.Hourly.IsDay, response.Hourly.PrecipitationProbability), daily, nil
}

// upcomingHours keeps the next 24 hourly slots starting at the current local hour.
// Open-Meteo returns whole days, so earlier hours of today are dropped here.
func upcomingHours(currentTime string, times []string, temperatures []float64, codes []int, isDay []int, precipitation []*float64) []Hourly {
	count := len(times)
	if count == 0 || len(temperatures) != count || len(codes) != count || len(isDay) != count {
		return nil
	}
	currentHour := currentTime
	if len(currentHour) >= 13 {
		currentHour = currentHour[:13]
	}
	hourly := make([]Hourly, 0, hourlyHours)
	for index, slot := range times {
		// Times share the "2006-01-02T15:04" local format, so string order is time order.
		if len(slot) < 13 || slot[:13] < currentHour {
			continue
		}
		hourly = append(hourly, Hourly{
			Time: slot, Temperature: temperatures[index], WeatherCode: codes[index], IsDay: isDay[index] == 1,
			PrecipitationProbability: int(math.Round(floatAt(precipitation, index))),
		})
		if len(hourly) == hourlyHours {
			break
		}
	}
	return hourly
}

func stringAt(values []string, index int) string {
	if index < len(values) {
		return values[index]
	}
	return ""
}

func floatAt(values []*float64, index int) float64 {
	if index < len(values) && values[index] != nil {
		return *values[index]
	}
	return 0
}

func (client *Client) getJSON(ctx context.Context, endpoint string, target interface{}) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "Panel-Next weather widget")
	response, err := client.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("upstream returned status %d", response.StatusCode)
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, maxResponseBytes))
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("decode upstream response: %w", err)
	}
	return nil
}
