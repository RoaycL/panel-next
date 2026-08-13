package syncApiStructs

import "encoding/json"

const ChangesSchemaVersion = 1

type ChangesResponse struct {
	SchemaVersion   int      `json:"schemaVersion"`
	FromRevision    string   `json:"fromRevision"`
	NextRevision    string   `json:"nextRevision"`
	CurrentRevision string   `json:"currentRevision"`
	HasMore         bool     `json:"hasMore"`
	Changes         []Change `json:"changes"`
}

type Change struct {
	Revision     string          `json:"revision"`
	ResourceType string          `json:"resourceType"`
	ResourceID   string          `json:"resourceId"`
	Operation    string          `json:"operation"`
	ChangedAt    string          `json:"changedAt"`
	Data         json.RawMessage `json:"data"`
}
