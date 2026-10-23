package share

import (
	"errors"
	"io"
	"mime"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

const textFileLimit = 8 << 20

// Keep these hints in sync with clients/shared/text-file-fixture.json via tests.
const textFileApplicationTypes = "application/json application/ld+json application/javascript application/ecmascript application/xml application/yaml application/x-yaml application/toml application/sql application/graphql"
const textFileExtensions = "txt md markdown json jsonl ndjson yaml yml toml xml csv tsv log js mjs cjs jsx ts tsx py rs go c h cc cpp hpp java kt kts swift dart cs php rb sh bash zsh sql html htm css scss"

func textFileCandidate(name, contentType string) bool {
	var typ string
	if contentType != "" {
		var params map[string]string
		var err error
		typ, params, err = mime.ParseMediaType(contentType)
		if err != nil {
			return false
		}
		if charset, present := params["charset"]; present && !strings.EqualFold(charset, "utf-8") {
			return false
		}
	}
	return strings.HasPrefix(typ, "text/") ||
		slices.Contains(strings.Fields(textFileApplicationTypes), typ) ||
		slices.Contains(strings.Fields(textFileExtensions), strings.TrimPrefix(strings.ToLower(filepath.Ext(name)), "."))
}

// openContent already checks the record against this immutable descriptor's size.
func prepareTextFile(row record, file *os.File) error {
	if !textFileCandidate(row.Name, row.MIMEType) {
		return &itemError{415, "not_text", "File is not a supported text candidate; use Download"}
	}
	if row.Size > textFileLimit {
		return &itemError{413, "text_too_large", "File exceeds the 8 MiB text preparation limit; use Download"}
	}
	count, _, _, err := inspectContent(io.LimitReader(file, textFileLimit+1), true, true)
	if errors.Is(err, errValidation) {
		return &itemError{415, "not_text", "File is not UTF-8 text without binary controls; use Download"}
	}
	if err != nil {
		return err
	}
	if count > textFileLimit {
		return &itemError{413, "text_too_large", "File exceeds the 8 MiB text preparation limit; use Download"}
	}
	if count != row.Size {
		return &itemError{409, "content_unavailable", "Stored content failed a length check"}
	}
	_, err = file.Seek(0, io.SeekStart)
	return err
}
