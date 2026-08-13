package syncApiStructs

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestChangesResponseV1JSONContract(t *testing.T) {
	response := ChangesResponse{
		SchemaVersion: ChangesSchemaVersion, FromRevision: "9007199254740992",
		NextRevision: "9007199254740993", CurrentRevision: "9007199254740993",
		Changes: []Change{{
			Revision: "9007199254740993", ResourceType: "group", ResourceID: "11",
			Operation: "upsert", ChangedAt: "2026-08-10T12:00:00Z", Data: json.RawMessage(`{"title":"Apps"}`),
		}},
	}
	encoded, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	body := string(encoded)
	for _, expected := range []string{
		`"schemaVersion":1`, `"fromRevision":"9007199254740992"`,
		`"nextRevision":"9007199254740993"`, `"currentRevision":"9007199254740993"`,
		`"resourceType":"group"`, `"data":{"title":"Apps"}`,
	} {
		if !strings.Contains(body, expected) {
			t.Fatalf("changes response is missing %s: %s", expected, body)
		}
	}
}
