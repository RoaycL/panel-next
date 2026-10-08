package weather

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync/atomic"
	"testing"
	"time"
)

func TestClientFetchesAndCachesWeather(t *testing.T) {
	var geocodeCalls atomic.Int32
	var forecastCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/geocode":
			geocodeCalls.Add(1)
			if request.URL.Query().Get("name") != "北京" || request.URL.Query().Get("language") != "zh" {
				t.Fatalf("unexpected geocoding query: %s", request.URL.RawQuery)
			}
			_, _ = response.Write([]byte(`{"results":[{"name":"北京","admin1":"北京市","country":"中国","latitude":39.9042,"longitude":116.4074,"timezone":"Asia/Shanghai"}]}`))
		case "/forecast":
			forecastCalls.Add(1)
			if request.URL.Query().Get("forecast_days") != "10" || request.URL.Query().Get("daily") != "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max" {
				t.Fatalf("unexpected forecast query: %s", request.URL.RawQuery)
			}
			_, _ = response.Write([]byte(`{"current":{"time":"2026-08-13T12:00","temperature_2m":31.5,"relative_humidity_2m":52,"apparent_temperature":33.1,"is_day":1,"weather_code":2,"wind_speed_10m":8.4},"current_units":{"temperature_2m":"°C","wind_speed_10m":"km/h"},"hourly":{"time":["2026-08-13T10:00","2026-08-13T11:00","2026-08-13T12:00","2026-08-13T13:00"],"temperature_2m":[29,30,31.5,32],"weather_code":[1,2,2,3],"is_day":[1,1,1,1],"precipitation_probability":[0,5,null,20]},"daily":{"time":["2026-08-13","2026-08-14"],"weather_code":[2,61],"temperature_2m_max":[34,29],"temperature_2m_min":[25,23],"sunrise":["2026-08-13T05:23","2026-08-14T05:24"],"sunset":["2026-08-13T19:15","2026-08-14T19:14"],"uv_index_max":[8.1,null],"precipitation_probability_max":[10,80]}}`))
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	client := NewClient(server.Client(), server.URL+"/geocode", server.URL+"/forecast", time.Minute, time.Hour)
	first, err := client.Get(context.Background(), "北京", "metric", "zh-CN")
	if err != nil {
		t.Fatal(err)
	}
	if first.Cached || first.Stale || first.Current.Temperature != 31.5 || first.Location.Country != "中国" || len(first.Daily) != 2 || first.Daily[1].WeatherCode != 61 ||
		first.Daily[0].Sunrise != "2026-08-13T05:23" || first.Daily[1].PrecipitationProbability != 80 || first.Daily[1].UVIndexMax != 0 {
		t.Fatalf("unexpected first result: %#v", first)
	}
	if len(first.Hourly) != 2 || first.Hourly[0].Time != "2026-08-13T12:00" || first.Hourly[0].PrecipitationProbability != 0 || first.Hourly[1].PrecipitationProbability != 20 {
		t.Fatalf("expected hourly slots from the current hour: %#v", first.Hourly)
	}
	second, err := client.Get(context.Background(), "北京", "metric", "zh-CN")
	if err != nil {
		t.Fatal(err)
	}
	if !second.Cached || second.Stale {
		t.Fatalf("unexpected cached result: %#v", second)
	}
	if geocodeCalls.Load() != 1 || forecastCalls.Load() != 1 {
		t.Fatalf("expected one upstream call each, got geocode=%d forecast=%d", geocodeCalls.Load(), forecastCalls.Load())
	}
}

func TestClientFallsBackToStaleCache(t *testing.T) {
	var fail atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if fail.Load() {
			http.Error(response, "unavailable", http.StatusServiceUnavailable)
			return
		}
		if request.URL.Path == "/geocode" {
			_, _ = response.Write([]byte(`{"results":[{"name":"Paris","country":"France","latitude":48.8566,"longitude":2.3522}]}`))
			return
		}
		_, _ = response.Write([]byte(`{"current":{"time":"2026-08-13T12:00","temperature_2m":75,"relative_humidity_2m":45,"apparent_temperature":75,"is_day":1,"weather_code":0,"wind_speed_10m":5},"current_units":{"temperature_2m":"°F","wind_speed_10m":"mp/h"}}`))
	}))
	defer server.Close()

	now := time.Now()
	client := NewClient(server.Client(), server.URL+"/geocode", server.URL+"/forecast", time.Minute, time.Hour)
	client.now = func() time.Time { return now }
	if _, err := client.Get(context.Background(), "Paris", "imperial", "en-US"); err != nil {
		t.Fatal(err)
	}
	now = now.Add(2 * time.Minute)
	fail.Store(true)
	result, err := client.Get(context.Background(), "Paris", "imperial", "en-US")
	if err != nil {
		t.Fatal(err)
	}
	if !result.Cached || !result.Stale {
		t.Fatalf("expected stale cached result, got %#v", result)
	}
}

func TestClientValidatesInputAndMissingLocation(t *testing.T) {
	client := NewClient(nil, "https://example.invalid/geocode", "https://example.invalid/forecast", time.Minute, time.Hour)
	if _, err := client.Get(context.Background(), "x", "metric", "en"); !errors.Is(err, ErrInvalidCity) {
		t.Fatalf("expected invalid city, got %v", err)
	}
	if _, err := client.Get(context.Background(), "Paris", "kelvin", "en"); !errors.Is(err, ErrInvalidUnits) {
		t.Fatalf("expected invalid units, got %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		_, _ = response.Write([]byte(`{"results":[]}`))
	}))
	defer server.Close()
	client = NewClient(server.Client(), server.URL, server.URL, time.Minute, time.Hour)
	if _, err := client.Get(context.Background(), "Nowhere", "metric", "en"); !errors.Is(err, ErrLocationNotFound) {
		t.Fatalf("expected missing location, got %v", err)
	}
}

func TestCachePruningIsBounded(t *testing.T) {
	client := NewClient(nil, "http://example.invalid", "http://example.invalid", time.Minute, time.Hour)
	now := time.Now()
	for index := 0; index < maxCacheEntries+10; index++ {
		client.cache[strconv.Itoa(index)] = cacheEntry{staleUntil: now.Add(time.Hour)}
	}
	client.pruneCacheLocked(now)
	if len(client.cache) >= maxCacheEntries {
		t.Fatalf("cache was not pruned below insertion limit: %d", len(client.cache))
	}
}
