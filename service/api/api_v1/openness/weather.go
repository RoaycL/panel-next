package openness

import (
	"errors"
	"strings"

	"sun-panel/api/api_v1/common/apiReturn"
	"sun-panel/lib/weather"

	"github.com/gin-gonic/gin"
)

func (a *Openness) Weather(c *gin.Context) {
	city := strings.TrimSpace(c.Query("city"))
	units := strings.ToLower(strings.TrimSpace(c.DefaultQuery("units", "metric")))
	result, err := weather.DefaultClient.Get(c.Request.Context(), city, units, c.GetHeader("lang"))
	if err != nil {
		switch {
		case errors.Is(err, weather.ErrInvalidCity), errors.Is(err, weather.ErrInvalidUnits):
			apiReturn.ErrorParamFomat(c, "city or units")
		case errors.Is(err, weather.ErrLocationNotFound):
			apiReturn.Error(c, "weather location not found")
		default:
			apiReturn.Error(c, "weather service unavailable")
		}
		return
	}
	apiReturn.SuccessData(c, result)
}
