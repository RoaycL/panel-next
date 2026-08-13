package panel

import (
	"errors"
	"strconv"

	"sun-panel/api/api_v1/common/apiReturn"
	"sun-panel/lib/syncstate"

	"github.com/gin-gonic/gin"
	"github.com/gin-gonic/gin/binding"
)

const syncConflictCode = 1502

type syncMutationRequest[T any] struct {
	ExpectedRevision string `json:"expectedRevision"`
	Data             T      `json:"data"`
}

type syncMutationResponse struct {
	Revision string `json:"revision"`
	Result   any    `json:"result"`
}

func bindSyncMutation[T any](c *gin.Context) (T, int64, bool) {
	request := syncMutationRequest[T]{}
	if err := c.ShouldBindBodyWith(&request, binding.JSON); err != nil {
		apiReturn.ErrorParamFomat(c, err.Error())
		return request.Data, 0, false
	}
	revision, err := strconv.ParseInt(request.ExpectedRevision, 10, 64)
	if err != nil || revision < 0 || strconv.FormatInt(revision, 10) != request.ExpectedRevision {
		apiReturn.ErrorParamFomat(c, "expectedRevision must be a non-negative base-10 integer string")
		return request.Data, 0, false
	}
	return request.Data, revision, true
}

func returnSyncMutation(c *gin.Context, revision int64, result any) {
	apiReturn.SuccessData(c, syncMutationResponse{Revision: strconv.FormatInt(revision, 10), Result: result})
}

func returnSyncMutationError(c *gin.Context, err error) {
	if errors.Is(err, syncstate.ErrRevisionConflict) {
		apiReturn.ErrorByCode(c, syncConflictCode)
		return
	}
	apiReturn.ErrorDatabase(c, err.Error())
}
