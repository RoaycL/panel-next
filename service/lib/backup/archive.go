package backup

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	FormatVersion = 1
	ManifestPath  = "manifest.json"
)

var (
	ErrInvalidArchive = errors.New("invalid backup archive")
	ErrFutureFormat   = errors.New("backup format is newer than this application supports")
)

type Database struct {
	Driver string `json:"driver"`
	Mode   string `json:"mode"`
}

type Entry struct {
	Path   string `json:"path"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

type Manifest struct {
	FormatVersion      int       `json:"formatVersion"`
	Application        string    `json:"application"`
	ApplicationVersion string    `json:"applicationVersion,omitempty"`
	CreatedAt          time.Time `json:"createdAt"`
	Database           Database  `json:"database"`
	Entries            []Entry   `json:"entries"`
}

type Source struct {
	ArchivePath string
	LocalPath   string
}

type fileSource struct {
	archivePath string
	localPath   string
	info        fs.FileInfo
}

type CreateOptions struct {
	Application        string
	ApplicationVersion string
	CreatedAt          time.Time
	Database           Database
	Sources            []Source
}

type Limits struct {
	MaxFiles           int
	MaxFileSize        int64
	MaxTotalSize       int64
	MaxCompressionRate uint64
}

func DefaultLimits() Limits {
	return Limits{
		MaxFiles:           100_000,
		MaxFileSize:        2 << 30,
		MaxTotalSize:       20 << 30,
		MaxCompressionRate: 1_000,
	}
}

func Create(ctx context.Context, output io.Writer, options CreateOptions) (Manifest, error) {
	manifest := Manifest{
		FormatVersion:      FormatVersion,
		Application:        options.Application,
		ApplicationVersion: options.ApplicationVersion,
		CreatedAt:          options.CreatedAt.UTC(),
		Database:           options.Database,
	}
	if manifest.Application == "" {
		manifest.Application = "panel-next"
	}
	if manifest.CreatedAt.IsZero() {
		manifest.CreatedAt = time.Now().UTC()
	}

	files := make([]fileSource, 0)
	seen := make(map[string]struct{})
	for _, source := range options.Sources {
		archiveRoot, err := cleanArchivePath(source.ArchivePath)
		if err != nil {
			return Manifest{}, fmt.Errorf("%w: source path %q: %v", ErrInvalidArchive, source.ArchivePath, err)
		}
		info, err := os.Lstat(source.LocalPath)
		if err != nil {
			return Manifest{}, fmt.Errorf("read backup source %q: %w", source.LocalPath, err)
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return Manifest{}, fmt.Errorf("%w: symbolic link source %q", ErrInvalidArchive, source.LocalPath)
		}
		if info.Mode().IsRegular() {
			if err := appendFileSource(&files, seen, archiveRoot, source.LocalPath, info); err != nil {
				return Manifest{}, err
			}
			continue
		}
		if !info.IsDir() {
			return Manifest{}, fmt.Errorf("%w: unsupported source %q", ErrInvalidArchive, source.LocalPath)
		}
		err = filepath.WalkDir(source.LocalPath, func(localPath string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if err := ctx.Err(); err != nil {
				return err
			}
			if localPath == source.LocalPath {
				return nil
			}
			entryInfo, err := entry.Info()
			if err != nil {
				return err
			}
			if entryInfo.Mode()&os.ModeSymlink != 0 {
				return fmt.Errorf("%w: symbolic link %q", ErrInvalidArchive, localPath)
			}
			if entry.IsDir() {
				return nil
			}
			if !entryInfo.Mode().IsRegular() {
				return fmt.Errorf("%w: unsupported file %q", ErrInvalidArchive, localPath)
			}
			relative, err := filepath.Rel(source.LocalPath, localPath)
			if err != nil {
				return err
			}
			return appendFileSource(&files, seen, archiveRoot+"/"+filepath.ToSlash(relative), localPath, entryInfo)
		})
		if err != nil {
			return Manifest{}, fmt.Errorf("walk backup source %q: %w", source.LocalPath, err)
		}
	}

	sort.Slice(files, func(i, j int) bool { return files[i].archivePath < files[j].archivePath })
	zipWriter := zip.NewWriter(output)
	closeWithError := func(err error) (Manifest, error) {
		_ = zipWriter.Close()
		return Manifest{}, err
	}
	for _, source := range files {
		if err := ctx.Err(); err != nil {
			return closeWithError(err)
		}
		header := &zip.FileHeader{Name: source.archivePath, Method: zip.Deflate}
		header.SetMode(0600)
		header.SetModTime(source.info.ModTime())
		entryWriter, err := zipWriter.CreateHeader(header)
		if err != nil {
			return closeWithError(err)
		}
		input, err := os.Open(source.localPath)
		if err != nil {
			return closeWithError(err)
		}
		hash := sha256.New()
		written, copyErr := io.Copy(io.MultiWriter(entryWriter, hash), input)
		closeErr := input.Close()
		if copyErr != nil {
			return closeWithError(copyErr)
		}
		if closeErr != nil {
			return closeWithError(closeErr)
		}
		if written != source.info.Size() {
			return closeWithError(fmt.Errorf("backup source changed while reading %q", source.localPath))
		}
		manifest.Entries = append(manifest.Entries, Entry{
			Path:   source.archivePath,
			Size:   written,
			SHA256: hex.EncodeToString(hash.Sum(nil)),
		})
	}

	manifestHeader := &zip.FileHeader{Name: ManifestPath, Method: zip.Deflate}
	manifestHeader.SetMode(0600)
	manifestHeader.SetModTime(manifest.CreatedAt)
	manifestWriter, err := zipWriter.CreateHeader(manifestHeader)
	if err != nil {
		return closeWithError(err)
	}
	encoder := json.NewEncoder(manifestWriter)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(manifest); err != nil {
		return closeWithError(err)
	}
	if err := zipWriter.Close(); err != nil {
		return Manifest{}, err
	}
	return manifest, nil
}

func Validate(reader io.ReaderAt, size int64, limits Limits) (Manifest, error) {
	archive, err := zip.NewReader(reader, size)
	if err != nil {
		return Manifest{}, fmt.Errorf("%w: %v", ErrInvalidArchive, err)
	}
	if limits.MaxFiles <= 0 || limits.MaxFileSize <= 0 || limits.MaxTotalSize <= 0 {
		return Manifest{}, fmt.Errorf("invalid validation limits")
	}
	if len(archive.File) == 0 || len(archive.File) > limits.MaxFiles+1 {
		return Manifest{}, fmt.Errorf("%w: file count exceeds limit", ErrInvalidArchive)
	}

	files := make(map[string]*zip.File, len(archive.File))
	var manifestFile *zip.File
	var total uint64
	for _, file := range archive.File {
		name, err := cleanArchivePath(file.Name)
		if err != nil || name != file.Name {
			return Manifest{}, fmt.Errorf("%w: unsafe path %q", ErrInvalidArchive, file.Name)
		}
		if _, exists := files[name]; exists {
			return Manifest{}, fmt.Errorf("%w: duplicate path %q", ErrInvalidArchive, name)
		}
		if file.FileInfo().IsDir() || !file.Mode().IsRegular() {
			return Manifest{}, fmt.Errorf("%w: non-regular entry %q", ErrInvalidArchive, name)
		}
		if file.Flags&0x1 != 0 {
			return Manifest{}, fmt.Errorf("%w: encrypted entry %q", ErrInvalidArchive, name)
		}
		if file.UncompressedSize64 > uint64(limits.MaxFileSize) {
			return Manifest{}, fmt.Errorf("%w: file %q exceeds size limit", ErrInvalidArchive, name)
		}
		if limits.MaxCompressionRate > 0 && file.CompressedSize64 > 0 && file.UncompressedSize64/file.CompressedSize64 > limits.MaxCompressionRate {
			return Manifest{}, fmt.Errorf("%w: suspicious compression ratio for %q", ErrInvalidArchive, name)
		}
		total += file.UncompressedSize64
		if total > uint64(limits.MaxTotalSize) {
			return Manifest{}, fmt.Errorf("%w: total size exceeds limit", ErrInvalidArchive)
		}
		files[name] = file
		if name == ManifestPath {
			manifestFile = file
		}
	}
	if manifestFile == nil {
		return Manifest{}, fmt.Errorf("%w: missing manifest", ErrInvalidArchive)
	}

	manifestReader, err := manifestFile.Open()
	if err != nil {
		return Manifest{}, fmt.Errorf("%w: open manifest: %v", ErrInvalidArchive, err)
	}
	var manifest Manifest
	decoder := json.NewDecoder(io.LimitReader(manifestReader, 1<<20))
	decoder.DisallowUnknownFields()
	decodeErr := decoder.Decode(&manifest)
	closeErr := manifestReader.Close()
	if decodeErr != nil {
		return Manifest{}, fmt.Errorf("%w: decode manifest: %v", ErrInvalidArchive, decodeErr)
	}
	if closeErr != nil {
		return Manifest{}, closeErr
	}
	if manifest.FormatVersion > FormatVersion {
		return Manifest{}, ErrFutureFormat
	}
	if manifest.FormatVersion != FormatVersion || (manifest.Application != "panel-next" && manifest.Application != "sun-panel") {
		return Manifest{}, fmt.Errorf("%w: unsupported manifest", ErrInvalidArchive)
	}
	if len(manifest.Entries) != len(files)-1 {
		return Manifest{}, fmt.Errorf("%w: manifest entry count mismatch", ErrInvalidArchive)
	}

	declared := make(map[string]Entry, len(manifest.Entries))
	for _, entry := range manifest.Entries {
		name, err := cleanArchivePath(entry.Path)
		if err != nil || name != entry.Path || name == ManifestPath {
			return Manifest{}, fmt.Errorf("%w: unsafe manifest path %q", ErrInvalidArchive, entry.Path)
		}
		if _, exists := declared[name]; exists {
			return Manifest{}, fmt.Errorf("%w: duplicate manifest path %q", ErrInvalidArchive, name)
		}
		file, exists := files[name]
		if !exists || int64(file.UncompressedSize64) != entry.Size {
			return Manifest{}, fmt.Errorf("%w: size mismatch for %q", ErrInvalidArchive, name)
		}
		if len(entry.SHA256) != sha256.Size*2 {
			return Manifest{}, fmt.Errorf("%w: invalid checksum for %q", ErrInvalidArchive, name)
		}
		input, err := file.Open()
		if err != nil {
			return Manifest{}, err
		}
		hash := sha256.New()
		_, copyErr := io.Copy(hash, io.LimitReader(input, limits.MaxFileSize+1))
		closeErr := input.Close()
		if copyErr != nil {
			return Manifest{}, copyErr
		}
		if closeErr != nil {
			return Manifest{}, closeErr
		}
		if !strings.EqualFold(hex.EncodeToString(hash.Sum(nil)), entry.SHA256) {
			return Manifest{}, fmt.Errorf("%w: checksum mismatch for %q", ErrInvalidArchive, name)
		}
		declared[name] = entry
	}
	return manifest, nil
}

func Extract(reader io.ReaderAt, size int64, destination string, limits Limits) (Manifest, error) {
	manifest, err := Validate(reader, size, limits)
	if err != nil {
		return Manifest{}, err
	}
	archive, err := zip.NewReader(reader, size)
	if err != nil {
		return Manifest{}, err
	}
	destination, err = filepath.Abs(destination)
	if err != nil {
		return Manifest{}, err
	}
	if err := os.MkdirAll(destination, 0700); err != nil {
		return Manifest{}, err
	}
	for _, file := range archive.File {
		if file.Name == ManifestPath {
			continue
		}
		target := filepath.Join(destination, filepath.FromSlash(file.Name))
		relative, err := filepath.Rel(destination, target)
		if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			return Manifest{}, fmt.Errorf("%w: extraction escaped destination", ErrInvalidArchive)
		}
		if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			return Manifest{}, err
		}
		input, err := file.Open()
		if err != nil {
			return Manifest{}, err
		}
		output, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			_ = input.Close()
			return Manifest{}, err
		}
		_, copyErr := io.Copy(output, input)
		inputCloseErr := input.Close()
		outputCloseErr := output.Close()
		if copyErr != nil {
			return Manifest{}, copyErr
		}
		if inputCloseErr != nil {
			return Manifest{}, inputCloseErr
		}
		if outputCloseErr != nil {
			return Manifest{}, outputCloseErr
		}
	}
	return manifest, nil
}

func appendFileSource(files *[]fileSource, seen map[string]struct{}, archivePath, localPath string, info fs.FileInfo) error {
	cleaned, err := cleanArchivePath(archivePath)
	if err != nil {
		return fmt.Errorf("%w: archive path %q: %v", ErrInvalidArchive, archivePath, err)
	}
	if cleaned == ManifestPath {
		return fmt.Errorf("%w: reserved path %q", ErrInvalidArchive, cleaned)
	}
	if _, exists := seen[cleaned]; exists {
		return fmt.Errorf("%w: duplicate source path %q", ErrInvalidArchive, cleaned)
	}
	seen[cleaned] = struct{}{}
	*files = append(*files, fileSource{archivePath: cleaned, localPath: localPath, info: info})
	return nil
}

func cleanArchivePath(value string) (string, error) {
	if value == "" || strings.ContainsRune(value, '\\') || strings.ContainsRune(value, '\x00') {
		return "", errors.New("path is empty or contains forbidden characters")
	}
	if strings.HasPrefix(value, "/") || filepath.IsAbs(value) {
		return "", errors.New("absolute paths are forbidden")
	}
	parts := strings.Split(value, "/")
	for _, part := range parts {
		if part == "" || part == "." || part == ".." {
			return "", errors.New("path contains an unsafe segment")
		}
	}
	return strings.Join(parts, "/"), nil
}
