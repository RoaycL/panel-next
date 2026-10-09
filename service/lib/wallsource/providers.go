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

type unsplashPhoto struct {
	ID             string `json:"id"`
	Width          int    `json:"width"`
	Height         int    `json:"height"`
	Likes          int64  `json:"likes"`
	Description    string `json:"description"`
	AltDescription string `json:"alt_description"`
	URLs           struct {
		Raw   string `json:"raw"`
		Small string `json:"small"`
	} `json:"urls"`
	Links struct {
		HTML string `json:"html"`
	} `json:"links"`
	User struct {
		Name  string `json:"name"`
		Links struct {
			HTML string `json:"html"`
		} `json:"links"`
	} `json:"user"`
}

// Unsplash asks API users to link back with these referral parameters.
const unsplashReferral = "utm_source=panel_next&utm_medium=referral"

func withQuery(rawURL, query string) string {
	if rawURL == "" {
		return ""
	}
	if strings.Contains(rawURL, "?") {
		return rawURL + "&" + query
	}
	return rawURL + "?" + query
}

func (client *Client) searchUnsplash(ctx context.Context, params SearchParams) (Result, error) {
	base := strings.TrimRight(client.endpoints.Unsplash, "/")
	query := url.Values{
		"page":        {strconv.Itoa(params.Page)},
		"per_page":    {strconv.Itoa(perPage)},
		"orientation": {"landscape"},
	}
	endpoint := base + "/topics/wallpapers/photos"
	if params.Query != "" {
		endpoint = base + "/search/photos"
		query.Set("query", params.Query)
		if params.Sorting == "latest" {
			query.Set("order_by", "latest")
		}
	} else if params.Sorting != "" {
		query.Set("order_by", params.Sorting)
	}
	resp, err := client.get(ctx, "unsplash", endpoint+"?"+query.Encode(), map[string]string{
		"Accept":         "application/json",
		"Accept-Version": "v1",
		"Authorization":  "Client-ID " + params.APIKey,
	})
	if err != nil {
		return Result{}, err
	}
	total, _ := strconv.Atoi(resp.Header.Get("X-Total"))
	var photos []unsplashPhoto
	if params.Query != "" {
		var search struct {
			Total   int             `json:"total"`
			Results []unsplashPhoto `json:"results"`
		}
		err = decodeJSON(resp, &search)
		photos, total = search.Results, search.Total
	} else {
		err = decodeJSON(resp, &photos)
	}
	if err != nil {
		return Result{}, fmt.Errorf("Unsplash 返回的数据无法解析")
	}
	items := make([]Item, 0, len(photos))
	for _, photo := range photos {
		if photo.URLs.Raw == "" {
			continue
		}
		items = append(items, Item{
			ID:         photo.ID,
			URL:        withQuery(photo.Links.HTML, unsplashReferral),
			RawURL:     withQuery(photo.URLs.Raw, "w=3840&q=85&fm=jpg&fit=max"),
			ThumbURL:   firstNonEmpty(photo.URLs.Small, withQuery(photo.URLs.Raw, "w=480&q=70&fm=jpg")),
			Resolution: resolution(photo.Width, photo.Height),
			Favorites:  photo.Likes,
			Title:      firstNonEmpty(photo.Description, photo.AltDescription),
			Author:     photo.User.Name,
			AuthorURL:  withQuery(photo.User.Links.HTML, unsplashReferral),
		})
	}
	return Result{Items: items, Meta: MetaInfo{CurrentPage: params.Page, LastPage: lastPageFor(total, params.Page), PerPage: perPage, Total: total}}, nil
}

func (client *Client) searchPexels(ctx context.Context, params SearchParams) (Result, error) {
	// Pexels has no wallpaper feed and its curated list is mostly portrait,
	// so an empty query searches landscape "wallpaper" photos instead.
	q := params.Query
	if q == "" {
		q = "wallpaper"
	}
	query := url.Values{
		"query":       {q},
		"orientation": {"landscape"},
		"size":        {"large"},
		"page":        {strconv.Itoa(params.Page)},
		"per_page":    {strconv.Itoa(perPage)},
	}
	resp, err := client.get(ctx, "pexels", strings.TrimRight(client.endpoints.Pexels, "/")+"/v1/search?"+query.Encode(), map[string]string{
		"Accept":        "application/json",
		"Authorization": params.APIKey,
	})
	if err != nil {
		return Result{}, err
	}
	var upstream struct {
		TotalResults int `json:"total_results"`
		Photos       []struct {
			ID              int64  `json:"id"`
			Width           int    `json:"width"`
			Height          int    `json:"height"`
			URL             string `json:"url"`
			Alt             string `json:"alt"`
			Photographer    string `json:"photographer"`
			PhotographerURL string `json:"photographer_url"`
			Src             struct {
				Original string `json:"original"`
				Medium   string `json:"medium"`
			} `json:"src"`
		} `json:"photos"`
	}
	if err := decodeJSON(resp, &upstream); err != nil {
		return Result{}, fmt.Errorf("Pexels 返回的数据无法解析")
	}
	items := make([]Item, 0, len(upstream.Photos))
	for _, photo := range upstream.Photos {
		if photo.Src.Original == "" {
			continue
		}
		items = append(items, Item{
			ID:         strconv.FormatInt(photo.ID, 10),
			URL:        photo.URL,
			RawURL:     withQuery(photo.Src.Original, "auto=compress&cs=tinysrgb&w=3840"),
			ThumbURL:   firstNonEmpty(photo.Src.Medium, withQuery(photo.Src.Original, "auto=compress&cs=tinysrgb&w=480")),
			Resolution: resolution(photo.Width, photo.Height),
			Title:      photo.Alt,
			Author:     photo.Photographer,
			AuthorURL:  photo.PhotographerURL,
		})
	}
	total := upstream.TotalResults
	return Result{Items: items, Meta: MetaInfo{CurrentPage: params.Page, LastPage: lastPageFor(total, params.Page), PerPage: perPage, Total: total}}, nil
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
