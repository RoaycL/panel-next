package openness

import (
	"errors"
	"strconv"
	"strings"

	"sun-panel/api/api_v1/common/apiReturn"
	"sun-panel/lib/trending"

	"github.com/gin-gonic/gin"
)

func (a *Openness) Trending(c *gin.Context) {
	source := strings.TrimSpace(strings.ToLower(c.DefaultQuery("source", "weibo")))
	limit, err := strconv.Atoi(strings.TrimSpace(c.DefaultQuery("limit", "10")))
	if err != nil {
		apiReturn.ErrorParamFomat(c, "limit")
		return
	}
	result, err := trending.DefaultClient.Get(c.Request.Context(), source, limit)
	if err != nil {
		switch {
		case errors.Is(err, trending.ErrUnknownSource), errors.Is(err, trending.ErrInvalidLimit):
			apiReturn.ErrorParamFomat(c, "source or limit")
		case errors.Is(err, trending.ErrSourceEmptied):
			apiReturn.Error(c, "trending source is empty")
		default:
			apiReturn.Error(c, "trending service unavailable")
		}
		return
	}
	apiReturn.SuccessData(c, result)
}
