package system

import (
	"database/sql"
	"errors"
	"time"

	"panel-next/api/api_v1/common/apiReturn"
	"panel-next/api/api_v1/common/base"
	"panel-next/global"
	sessionlib "panel-next/lib/session"
	"panel-next/models"

	"github.com/gin-gonic/gin"
)

// A bounded, authenticated long poll works across multiple server processes:
// the sync revision in the shared database is the only notification source.
// The client uses the existing changes endpoint to fetch actual data.
var syncWaitTimeout = 25 * time.Second
var syncWaitPollInterval = 750 * time.Millisecond

type SyncWaitApi struct{}

func (a *SyncWaitApi) Get(c *gin.Context) {
	if _, ok := applyAPIVersionNegotiation(c); !ok {
		return
	}
	if mode, _ := c.Get(sessionlib.GinAuthModeKey); mode != sessionlib.AuthModeDevice {
		apiReturn.ErrorByCode(c, 1001)
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

	c.Header("Cache-Control", "no-store")
	ctx := c.Request.Context()
	deadline := time.NewTimer(syncWaitTimeout)
	ticker := time.NewTicker(syncWaitPollInterval)
	defer deadline.Stop()
	defer ticker.Stop()
	for {
		var revision int64
		err := global.Db.WithContext(ctx).Model(&models.UserSyncState{}).
			Where("user_id = ?", user.ID).Select("revision").Row().Scan(&revision)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			if ctx.Err() == nil {
				apiReturn.ErrorDatabase(c, err.Error())
			}
			return
		}
		if revision != since {
			apiReturn.SuccessData(c, gin.H{"revision": formatSyncRevision(revision), "changed": true})
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-deadline.C:
			apiReturn.SuccessData(c, gin.H{"revision": formatSyncRevision(revision), "changed": false})
			return
		case <-ticker.C:
		}
	}
}
