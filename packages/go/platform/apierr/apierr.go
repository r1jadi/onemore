// Package apierr defines the error vocabulary shared by every Unbored service.
// It has no dependencies so both the HTTP helpers and the auth package can use
// it without import cycles.
package apierr

import (
	"errors"
	"net/http"
)

// Code is a stable, machine-readable error identifier. Clients switch on this
// value — never on the human-readable message.
type Code string

const (
	CodeBadRequest     Code = "bad_request"
	CodeUnauthorized   Code = "unauthorized"
	CodeForbidden      Code = "forbidden"
	CodeNotFound       Code = "not_found"
	CodeConflict       Code = "conflict"
	CodeUnprocessable  Code = "unprocessable_entity"
	CodeRateLimited    Code = "rate_limited"
	CodePayloadTooBig  Code = "payload_too_large"
	CodeUnsupported    Code = "unsupported_media_type"
	CodeNotImplemented Code = "not_implemented"
	CodeUnavailable    Code = "service_unavailable"
	CodeTimeout        Code = "timeout"
	CodeInternal       Code = "internal_error"
)

// Detail describes one validation problem. Field names are stable so the
// frontend can map them onto form inputs.
type Detail struct {
	Field string `json:"field"`
	Rule  string `json:"rule"`
}

// Envelope is the response body for every non-2xx API response.
type Envelope struct {
	Error Body `json:"error"`
}

// Body carries the error payload itself.
type Body struct {
	Code      Code     `json:"code"`
	Message   string   `json:"message"`
	RequestID string   `json:"request_id,omitempty"`
	Details   []Detail `json:"details,omitempty"`
}

// Error is a typed API error that carries a code and a caller-safe message.
type Error struct {
	ErrorCode Code
	Message   string
	Details   []Detail
}

func (e *Error) Error() string { return string(e.ErrorCode) + ": " + e.Message }

// New builds a typed API error.
func New(code Code, message string, details ...Detail) *Error {
	return &Error{ErrorCode: code, Message: message, Details: details}
}

// Status maps a code onto the HTTP status it must be served with.
func Status(code Code) int {
	switch code {
	case CodeBadRequest:
		return http.StatusBadRequest
	case CodeUnauthorized:
		return http.StatusUnauthorized
	case CodeForbidden:
		return http.StatusForbidden
	case CodeNotFound:
		return http.StatusNotFound
	case CodeConflict:
		return http.StatusConflict
	case CodeUnprocessable:
		return http.StatusUnprocessableEntity
	case CodeRateLimited:
		return http.StatusTooManyRequests
	case CodePayloadTooBig:
		return http.StatusRequestEntityTooLarge
	case CodeUnsupported:
		return http.StatusUnsupportedMediaType
	case CodeNotImplemented:
		return http.StatusNotImplemented
	case CodeUnavailable:
		return http.StatusServiceUnavailable
	case CodeTimeout:
		return http.StatusGatewayTimeout
	default:
		return http.StatusInternalServerError
	}
}

// Sentinels for callers that do not need a custom message.
var (
	ErrNotFound     = errors.New("not found")
	ErrUnauthorized = errors.New("unauthorized")
	ErrForbidden    = errors.New("forbidden")
	ErrUnavailable  = errors.New("unavailable")
	ErrTimeout      = errors.New("timeout")
)

// BodyFor converts any error into a caller-safe envelope body. Unknown errors
// collapse to a generic 500 so internals never leak.
func BodyFor(err error, requestID string) Body {
	var typed *Error
	if errors.As(err, &typed) {
		return Body{Code: typed.ErrorCode, Message: typed.Message, RequestID: requestID, Details: typed.Details}
	}
	switch {
	case errors.Is(err, ErrNotFound):
		return Body{Code: CodeNotFound, Message: "Resource not found.", RequestID: requestID}
	case errors.Is(err, ErrUnauthorized):
		return Body{Code: CodeUnauthorized, Message: "Authentication required.", RequestID: requestID}
	case errors.Is(err, ErrForbidden):
		return Body{Code: CodeForbidden, Message: "You do not have access to this resource.", RequestID: requestID}
	case errors.Is(err, ErrUnavailable):
		return Body{Code: CodeUnavailable, Message: "This service is temporarily unavailable.", RequestID: requestID}
	case errors.Is(err, ErrTimeout):
		return Body{Code: CodeTimeout, Message: "The upstream service did not respond in time.", RequestID: requestID}
	default:
		return Body{Code: CodeInternal, Message: "Something went wrong on our side.", RequestID: requestID}
	}
}
