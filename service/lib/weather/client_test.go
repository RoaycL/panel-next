package weather

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
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
			_, _ = response.Write([]byte(`{"current":{"time":"2026-08-13T12:00","temperature_2m":31.5,"relative_humidity_2m":52,"apparent_temperature":33.1,"is_day":1,"weather_code":2,"wind_speed_10m":8.4},"current_units":{"temperature_2m":"°C","wind_speed_10m":"km/h"}}`))
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
	if first.Cached || first.Stale || first.Current.Temperature != 31.5 || first.Location.Country != "中国" {
		t.Fatalf("unexpected first result: %#v", first)
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
