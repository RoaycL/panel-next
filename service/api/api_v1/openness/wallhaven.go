package openness

import (
	"net/http"
	"panel-next/api/api_v1/common/apiReturn"
	"panel-next/lib/wallhaven"
	"strconv"

	"github.com/gin-gonic/gin"
)

// Wallhaven 提供 Wallhaven 壁纸搜索代理接口。
func (a *Openness) Wallhaven(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	params := wallhaven.SearchParams{
		Query:      c.Query("q"),
		Categories: c.DefaultQuery("categories", "110"),
		Purity:     c.DefaultQuery("purity", "100"),
		Sorting:    c.DefaultQuery("sorting", "toplist"),
		Order:      c.DefaultQuery("order", "desc"),
		TopRange:   c.DefaultQuery("topRange", "1M"),
		AtLeast:    c.DefaultQuery("atleast", "1920x1080"),
		Ratios:     c.Query("ratios"),
		Page:       page,
	}

	result, err := wallhaven.DefaultClient.Search(c.Request.Context(), params)
	if err != nil {
		apiReturn.Error(c, err.Error())
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"msg":  "OK",
		"data": result,
	})
}
