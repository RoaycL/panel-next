package system

import (
	"errors"
	"math"
	"strconv"
	"strings"

	"sun-panel/api/api_v1/common/apiData/syncApiStructs"
	"sun-panel/api/api_v1/common/apiReturn"
	"sun-panel/api/api_v1/common/base"
	"sun-panel/global"
	sessionlib "sun-panel/lib/session"
	"sun-panel/lib/syncstate"

	"github.com/gin-gonic/gin"
)

type SyncChangesApi struct{}

func (a *SyncChangesApi) Get(c *gin.Context) {
	if mode, _ := c.Get(sessionlib.GinAuthModeKey); mode != sessionlib.AuthModeDevice {
		apiReturn.ErrorByCode(c, 1001)
		return
	}
	if _, ok := applyAPIVersionNegotiation(c); !ok {
		return
	}
	user, exists := base.GetCurrentUserInfo(c)
	if !exists || user.ID == 0 {
		apiReturn.ErrorByCode(c, 1001)
		return
	}

	since, err := parseSyncRevisionQuery(c.Query("since"))
	if err != nil {
		apiReturn.ErrorCode(c, 1400, "since must be a non-negative base-10 integer", nil)
		return
	}
	limit := syncstate.DefaultChangeLimit
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		parsed, parseErr := strconv.Atoi(raw)
		if parseErr != nil || parsed < 1 || parsed > syncstate.MaximumChangeLimit {
			apiReturn.ErrorCode(c, 1400, "limit must be between 1 and 500", nil)
			return
		}
		limit = parsed
	}
	page, err := syncstate.NewManager(global.Db).List(c.Request.Context(), user.ID, since, limit)
	if errors.Is(err, syncstate.ErrRevisionAhead) {
		apiReturn.ErrorCode(c, 1501, "Sync cursor is ahead of the server", gin.H{
			"fullBootstrapRequired": true,
		})
		return
	}
	if err != nil {
		apiReturn.ErrorDatabase(c, err.Error())
		return
	}
	response := syncApiStructs.ChangesResponse{
		SchemaVersion: syncApiStructs.ChangesSchemaVersion,
		FromRevision:  formatSyncRevision(page.FromRevision), NextRevision: formatSyncRevision(page.NextRevision),
		CurrentRevision: formatSyncRevision(page.CurrentRevision), HasMore: page.HasMore,
		Changes: make([]syncApiStructs.Change, 0, len(page.Changes)),
	}
	for _, change := range page.Changes {
		response.Changes = append(response.Changes, syncApiStructs.Change{
			Revision: formatSyncRevision(change.Revision), ResourceType: change.ResourceType,
			ResourceID: change.ResourceID, Operation: change.Operation, ChangedAt: change.ChangedAt, Data: change.Payload,
		})
	}
	apiReturn.SuccessData(c, response)
}

func parseSyncRevisionQuery(raw string) (int64, error) {
	value := strings.TrimSpace(raw)
	if value == "" || (len(value) > 1 && value[0] == '0') {
		return 0, errors.New("invalid revision")
	}
	for _, character := range value {
		if character < '0' || character > '9' {
			return 0, errors.New("invalid revision")
		}
	}
	parsed, err := strconv.ParseUint(value, 10, 63)
	if err != nil || parsed > math.MaxInt64 {
		return 0, errors.New("invalid revision")
	}
	return int64(parsed), nil
}
