package weather

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
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
}

type Result struct {
	Location  Location  `json:"location"`
	Current   Current   `json:"current"`
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
	client.cache[key] = cacheEntry{
		result: result, expiresAt: now.Add(client.ttl), staleUntil: now.Add(client.staleTTL),
	}
	client.mu.Unlock()
	return result, nil
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
	current, err := client.forecast(ctx, location, units)
	if err != nil {
		return Result{}, err
	}
	return Result{Location: location, Current: current, Units: units}, nil
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

func (client *Client) forecast(ctx context.Context, location Location, units string) (Current, error) {
	query := url.Values{
		"latitude":      {fmt.Sprintf("%.6f", location.Latitude)},
		"longitude":     {fmt.Sprintf("%.6f", location.Longitude)},
		"current":       {"temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m"},
		"forecast_days": {"1"},
		"timezone":      {"auto"},
	}
	if units == "imperial" {
		query.Set("temperature_unit", "fahrenheit")
		query.Set("wind_speed_unit", "mph")
	}
	var response struct {
		Current struct {
			Time                string  `json:"time"`
			Temperature         float64 `json:"temperature_2m"`
			ApparentTemperature float64 `json:"apparent_temperature"`
			RelativeHumidity    int     `json:"relative_humidity_2m"`
			WeatherCode         int     `json:"weather_code"`
			WindSpeed           float64 `json:"wind_speed_10m"`
			IsDay               int     `json:"is_day"`
		} `json:"current"`
		CurrentUnits struct {
			Temperature string `json:"temperature_2m"`
			WindSpeed   string `json:"wind_speed_10m"`
		} `json:"current_units"`
	}
	if err := client.getJSON(ctx, client.forecastURL+"?"+query.Encode(), &response); err != nil {
		return Current{}, fmt.Errorf("forecast request: %w", err)
	}
	if response.Current.Time == "" || response.CurrentUnits.Temperature == "" || response.CurrentUnits.WindSpeed == "" {
		return Current{}, errors.New("forecast response is incomplete")
	}
	return Current{
		Time: response.Current.Time, Temperature: response.Current.Temperature,
		ApparentTemperature: response.Current.ApparentTemperature,
		RelativeHumidity:    response.Current.RelativeHumidity, WeatherCode: response.Current.WeatherCode,
		WindSpeed: response.Current.WindSpeed, IsDay: response.Current.IsDay == 1,
		TemperatureUnit: response.CurrentUnits.Temperature, WindSpeedUnit: response.CurrentUnits.WindSpeed,
	}, nil
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
