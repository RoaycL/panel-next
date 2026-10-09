package wallsource

import (
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"net/url"
	"strconv"
	"strings"
)

// Bing only exposes the last ~15 days: two windows of 8 (idx 0 and idx 7) overlap by one day.
func (client *Client) searchBing(ctx context.Context) (Result, error) {
	base := strings.TrimRight(client.endpoints.Bing, "/")
	seen := map[string]bool{}
	items := []Item{}
	for _, idx := range []string{"0", "7"} {
		resp, err := client.get(ctx, "bing", base+"/HPImageArchive.aspx?format=js&n=8&mkt=zh-CN&idx="+idx, map[string]string{"Accept": "application/json"})
		if err != nil {
			return Result{}, err
		}
		var upstream struct {
			Images []struct {
				StartDate     string `json:"startdate"`
				URLBase       string `json:"urlbase"`
				Copyright     string `json:"copyright"`
				CopyrightLink string `json:"copyrightlink"`
				Title         string `json:"title"`
			} `json:"images"`
		}
		if err := decodeJSON(resp, &upstream); err != nil {
			return Result{}, fmt.Errorf("Bing 返回的数据无法解析")
		}
		for _, image := range upstream.Images {
			if image.StartDate == "" || seen[image.StartDate] || !strings.HasPrefix(image.URLBase, "/th?id=") {
				continue
			}
			seen[image.StartDate] = true
			date := image.StartDate
			if len(date) == 8 {
				date = date[:4] + "-" + date[4:6] + "-" + date[6:]
			}
			pageURL := image.CopyrightLink
			if !strings.HasPrefix(pageURL, "https://") {
				pageURL = "https://cn.bing.com/"
			}
			items = append(items, Item{
				ID:         image.StartDate,
				URL:        pageURL,
				RawURL:     base + image.URLBase + "_UHD.jpg",
				ThumbURL:   base + image.URLBase + "_400x240.jpg",
				Resolution: "3840x2160",
				Category:   date,
				Title:      firstNonEmpty(image.Title, image.Copyright),
				Author:     image.Copyright,
			})
		}
	}
	return Result{Items: items, Meta: MetaInfo{CurrentPage: 1, LastPage: 1, PerPage: len(items), Total: len(items)}}, nil
}

// booruRatingTag turns the safe/questionable/explicit bitset into one Moebooru metatag.
func booruRatingTag(purity string) string {
	switch purity {
	case "100":
		return "rating:s"
	case "010":
		return "rating:q"
	case "001":
		return "rating:e"
	case "110":
		return "-rating:e"
	case "101":
		return "-rating:q"
	case "011":
		return "-rating:s"
	}
	return ""
}

// Boorus host many portrait scans that get dropped, so ask for a larger page.
const booruPerPage = 60

var booruRatingLabels = map[string]string{"s": "SFW", "q": "Sketchy", "e": "NSFW"}

// searchBooru queries a Moebooru site (Konachan, yande.re). post.xml carries the
// total count that post.json lacks, so pagination knows where to stop.
func (client *Client) searchBooru(ctx context.Context, base, siteName string, params SearchParams) (Result, error) {
	base = strings.TrimRight(base, "/")
	tags := strings.Fields(params.Query)
	if rating := booruRatingTag(params.Purity); rating != "" {
		tags = append(tags, rating)
	}
	switch params.Sorting {
	case "score":
		tags = append(tags, "order:score")
	case "random":
		tags = append(tags, "order:random")
	}
	// Wallpaper-sized images only.
	tags = append(tags, "width:1920..")
	query := url.Values{
		"limit": {strconv.Itoa(booruPerPage)},
		"page":  {strconv.Itoa(params.Page)},
		"tags":  {strings.Join(tags, " ")},
	}
	source := "konachan"
	if siteName == "yande.re" {
		source = "yandere"
	}
	resp, err := client.get(ctx, source, base+"/post.xml?"+query.Encode(), map[string]string{"Accept": "application/xml"})
	if err != nil {
		return Result{}, err
	}
	defer resp.Body.Close()
	var upstream struct {
		Count int `xml:"count,attr"`
		Posts []struct {
			ID         int64  `xml:"id,attr"`
			Tags       string `xml:"tags,attr"`
			Score      int64  `xml:"score,attr"`
			FileSize   int64  `xml:"file_size,attr"`
			FileURL    string `xml:"file_url,attr"`
			JpegURL    string `xml:"jpeg_url,attr"`
			SampleURL  string `xml:"sample_url,attr"`
			PreviewURL string `xml:"preview_url,attr"`
			Width      int    `xml:"width,attr"`
			Height     int    `xml:"height,attr"`
			Rating     string `xml:"rating,attr"`
			Author     string `xml:"author,attr"`
		} `xml:"post"`
	}
	if err := xml.NewDecoder(io.LimitReader(resp.Body, maxResponseBytes)).Decode(&upstream); err != nil {
		return Result{}, fmt.Errorf("%s 返回的数据无法解析", siteName)
	}
	items := make([]Item, 0, len(upstream.Posts))
	for _, post := range upstream.Posts {
		raw := firstNonEmpty(post.JpegURL, post.FileURL)
		if !strings.HasPrefix(raw, "https://") || post.Width < post.Height {
			// Portrait art makes a poor desktop wallpaper.
			continue
		}
		title := post.Tags
		if len(title) > 160 {
			title = title[:strings.LastIndex(title[:160], " ")+1] + "…"
		}
		items = append(items, Item{
			ID:         strconv.FormatInt(post.ID, 10),
			URL:        fmt.Sprintf("%s/post/show/%d", base, post.ID),
			RawURL:     raw,
			ThumbURL:   firstNonEmpty(post.PreviewURL, post.SampleURL),
			Resolution: resolution(post.Width, post.Height),
			Category:   booruRatingLabels[post.Rating],
			FileSize:   post.FileSize,
			Favorites:  post.Score,
			Title:      title,
			Author:     post.Author,
		})
	}
	if params.Sorting == "random" {
		// Random order has no stable count (yande.re reports a handful); every page is a fresh draw.
		next := params.Page
		if len(upstream.Posts) > 0 && next < 100 {
			next++
		}
		return Result{Items: items, Meta: MetaInfo{CurrentPage: params.Page, LastPage: next, PerPage: booruPerPage}}, nil
	}
	total := upstream.Count
	last := (total + booruPerPage - 1) / booruPerPage
	if last > 100 {
		last = 100
	}
	if last < params.Page {
		last = params.Page
	}
	return Result{Items: items, Meta: MetaInfo{CurrentPage: params.Page, LastPage: last, PerPage: booruPerPage, Total: total}}, nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
