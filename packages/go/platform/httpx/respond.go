// Package httpx contains the HTTP conventions shared by every Unbored service:
// one error envelope, one middleware chain, one server bootstrap.
package httpx

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/r1jadi/unbored/packages/go/platform/apierr"
)

// Error codes re-exported so services only need this package for HTTP concerns.
const (
	CodeBadRequest     = apierr.CodeBadRequest
	CodeUnauthorized   = apierr.CodeUnauthorized
	CodeForbidden      = apierr.CodeForbidden
	CodeNotFound       = apierr.CodeNotFound
	CodeConflict       = apierr.CodeConflict
	CodeUnprocessable  = apierr.CodeUnprocessable
	CodeRateLimited    = apierr.CodeRateLimited
	CodePayloadTooBig  = apierr.CodePayloadTooBig
	CodeUnsupported    = apierr.CodeUnsupported
	CodeNotImplemented = apierr.CodeNotImplemented
	CodeUnavailable    = apierr.CodeUnavailable
	CodeTimeout        = apierr.CodeTimeout
	CodeInternal       = apierr.CodeInternal
)

// Sentinels re-exported for handler use.
var (
	ErrNotFound     = apierr.ErrNotFound
	ErrUnauthorized = apierr.ErrUnauthorized
	ErrForbidden    = apierr.ErrForbidden
	ErrUnavailable  = apierr.ErrUnavailable
	ErrTimeout      = apierr.ErrTimeout
)

// NewError builds a typed API error.
func NewError(code apierr.Code, message string, details ...apierr.Detail) *apierr.Error {
	return apierr.New(code, message, details...)
}

// WriteJSON serialises a payload with no-store caching and nosniff.
func WriteJSON(w http.ResponseWriter, r *http.Request, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	if payload == nil || status == http.StatusNoContent {
		return
	}
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		// The response is already committed; log and move on rather than
		// writing a second body into the stream.
		slog.ErrorContext(r.Context(), "failed to encode response", slog.Any("error", err))
	}
}

// WriteError writes the standard envelope. Typed errors keep their code and
// message; anything else becomes a generic 500 so internals never leak.
func WriteError(w http.ResponseWriter, r *http.Request, err error) {
	body := errorBodyFor(r, err)
	WriteJSON(w, r, apierr.Status(body.Code), apierr.Envelope{Error: body})
}

func errorBodyFor(r *http.Request, err error) apierr.Body {
	if errors.As(err, new(*json.SyntaxError)) {
		return apierr.Body{Code: CodeBadRequest, Message: "The request body is not valid JSON.", RequestID: RequestIDFrom(r.Context())}
	}
	if errors.As(err, new(*json.UnmarshalTypeError)) {
		return apierr.Body{Code: CodeBadRequest, Message: "The request body contains a value of the wrong type.", RequestID: RequestIDFrom(r.Context())}
	}
	if errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, io.EOF) {
		return apierr.Body{Code: CodeBadRequest, Message: "The request body is empty or truncated.", RequestID: RequestIDFrom(r.Context())}
	}
	return apierr.BodyFor(err, RequestIDFrom(r.Context()))
}

// NotImplemented answers a planned-but-unbuilt endpoint. The route exists so
// the API surface is explicit and clients fail predictably until the feature
// task that owns it lands.
func NotImplemented(service, endpoint string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		WriteError(w, r, NewError(
			CodeNotImplemented,
			fmt.Sprintf("%s is not implemented yet.", endpoint),
			apierr.Detail{Field: "service", Rule: service},
		))
	}
}

// DecodeJSON reads a strict JSON body: unknown fields are rejected, the body is
// size limited and the content type must be JSON when provided. It never trusts
// the payload.
func DecodeJSON(w http.ResponseWriter, r *http.Request, limit int64, dst any) error {
	contentType := r.Header.Get("Content-Type")
	if contentType != "" {
		if media, _, _ := strings.Cut(contentType, ";"); strings.TrimSpace(strings.ToLower(media)) != "application/json" {
			return NewError(CodeUnsupported, "Expected an application/json request body.")
		}
	}

	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, limit))
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(dst); err != nil {
		var maxBytes *http.MaxBytesError
		if errors.As(err, &maxBytes) {
			return NewError(CodePayloadTooBig, "The request body is larger than the allowed limit.")
		}
		// encoding/json reports an unknown field as an untyped error, so a strict
		// decode has to translate it here. A caller mistake must be a 400, never
		// an internal 500 that hides the real problem from the client.
		if field, ok := unknownField(err); ok {
			return NewError(CodeBadRequest, "The request body contains a field this endpoint does not accept.", apierr.Detail{Field: field, Rule: "unknown"})
		}
		return err
	}
	if decoder.More() {
		return NewError(CodeBadRequest, "The request body must contain exactly one JSON object.")
	}
	return nil
}

// unknownField reports the field name of an encoding/json unknown-field error.
// The package exposes no typed error for this case, so the documented message
// prefix is the only stable way to recognise it.
func unknownField(err error) (string, bool) {
	const prefix = "json: unknown field "
	message := err.Error()
	if !strings.HasPrefix(message, prefix) {
		return "", false
	}
	return strings.Trim(message[len(prefix):], `"`), true
}

// RequireQuery rejects a request missing a required, non-empty query value.
func RequireQuery(r *http.Request, name string) (string, error) {
	value := strings.TrimSpace(r.URL.Query().Get(name))
	if value == "" {
		return "", NewError(CodeBadRequest, "Missing required query parameter.", apierr.Detail{Field: name, Rule: "required"})
	}
	return value, nil
}
