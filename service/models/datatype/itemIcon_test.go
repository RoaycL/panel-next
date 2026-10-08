package datatype

import (
	"encoding/json"
	"testing"
)

func TestItemIconScaleRoundTrip(t *testing.T) {
	icon := ItemIconIconInfo{ItemType: 2, Src: "/uploads/example.png", Scale: 1.28}
	encoded, err := json.Marshal(icon)
	if err != nil {
		t.Fatal(err)
	}
	var saved ItemIconIconInfo
	if err := json.Unmarshal(encoded, &saved); err != nil {
		t.Fatal(err)
	}
	if saved.Scale != 1.28 {
		t.Fatalf("lost scale: %v", saved.Scale)
	}
	var legacy ItemIconIconInfo
	if err := json.Unmarshal([]byte(`{"itemType":2,"src":"/uploads/old.png"}`), &legacy); err != nil {
		t.Fatal(err)
	}
	if legacy.Scale != 0 {
		t.Fatal("legacy icon size changed")
	}
	encoded, err = json.Marshal(legacy)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]interface{}
	if err := json.Unmarshal(encoded, &fields); err != nil {
		t.Fatal(err)
	}
	if _, exists := fields["scale"]; exists {
		t.Fatal("zero scale must not be sent to clients")
	}
}

func TestItemIconSurfaceRoundTrip(t *testing.T) {
	var saved ItemIconIconInfo
	if err := json.Unmarshal([]byte(`{"itemType":2,"src":"/uploads/a.png","surface":"glass"}`), &saved); err != nil {
		t.Fatal(err)
	}
	if saved.Surface != "glass" {
		t.Fatalf("lost surface: %q", saved.Surface)
	}
	encoded, err := json.Marshal(ItemIconIconInfo{ItemType: 2, Src: "/uploads/a.png"})
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]interface{}
	if err := json.Unmarshal(encoded, &fields); err != nil {
		t.Fatal(err)
	}
	if _, exists := fields["surface"]; exists {
		t.Fatal("empty surface must not be sent to clients")
	}
}
