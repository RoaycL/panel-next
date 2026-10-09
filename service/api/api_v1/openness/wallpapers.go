package openness

import (
	"errors"
	"net/http"
	"strconv"

	"panel-next/api/api_v1/common/apiReturn"
	"panel-next/lib/wallsource"

	"github.com/gin-gonic/gin"
)

// Wallpapers 代理 Wallhaven 以外的壁纸源（Bing 每日、Konachan、yande.re）。
func (a *Openness) Wallpapers(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	params := wallsource.SearchParams{
		Source:  c.Query("source"),
		Query:   c.Query("q"),
		Purity:  c.Query("purity"),
		Sorting: c.Query("sorting"),
		Page:    page,
	}

	result, err := wallsource.DefaultClient.Search(c.Request.Context(), params)
	if err != nil {
		if errors.Is(err, wallsource.ErrInvalidParams) {
			apiReturn.ErrorParamFomat(c, "wallpaper search parameters")
			return
		}
		apiReturn.Error(c, err.Error())
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"msg":  "OK",
		"data": result,
	})
}
