package syncApiStructs

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestBootstrapResponseV1JSONContract(t *testing.T) {
	response := BootstrapResponse{
		SchemaVersion: BootstrapSchemaVersion,
		Revision:      "9007199254740993",
		GeneratedAt:   time.Date(2026, 8, 9, 12, 0, 0, 0, time.UTC),
		Account: BootstrapAccount{
			ID: 7, Username: "sync@example.com", Name: "Sync User", Status: 1,
		},
		Panel: BootstrapPanel{
			Revision:     "9",
			Config:       map[string]interface{}{"logoText": "Panel Next"},
			SearchEngine: map[string]interface{}{"default": "google"},
			Groups: []BootstrapGroup{{
				ID: 11, Title: "Apps", Revision: "8", Items: []BootstrapItem{{
					ID: 12, Title: "Example", URL: "https://example.com", Revision: "7", ItemIconGroupID: 11,
				}},
			}},
		},
	}

	encoded, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	body := string(encoded)
	for _, required := range []string{
		`"schemaVersion":1`, `"revision":"9007199254740993"`, `"generatedAt":`,
		`"account":`, `"panel":`, `"revision":"9"`, `"config":`, `"searchEngine":`,
		`"groups":`, `"revision":"8"`, `"items":`, `"revision":"7"`,
	} {
		if !strings.Contains(body, required) {
			t.Fatalf("bootstrap response is missing %s: %s", required, body)
		}
	}
	for _, forbidden := range []string{`"password"`, `"token"`, `"userId"`, `"iconJson"`} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("bootstrap response exposed internal field %s: %s", forbidden, body)
		}
	}
}
