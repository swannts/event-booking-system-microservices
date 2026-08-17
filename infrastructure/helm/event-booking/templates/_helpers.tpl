{{- define "event-booking.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "event-booking.secretName" -}}
{{- if .Values.secrets.existingSecret -}}
{{- .Values.secrets.existingSecret -}}
{{- else -}}
{{- printf "%s-secret" (include "event-booking.fullname" .) -}}
{{- end -}}
{{- end -}}

{{- define "event-booking.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := include "event-booking.name" . -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "event-booking.namespace" -}}
{{- .Release.Namespace -}}
{{- end -}}

{{- define "event-booking.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "event-booking.selectorLabels" -}}
app.kubernetes.io/name: {{ include "event-booking.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "event-booking.labels" -}}
helm.sh/chart: {{ include "event-booking.chart" . }}
{{ include "event-booking.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: event-booking
{{- end -}}

{{- define "event-booking.componentFullname" -}}
{{- $root := index . "root" -}}
{{- $component := index . "component" -}}
{{- printf "%s-%s" (include "event-booking.fullname" $root) $component | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "event-booking.componentFqdn" -}}
{{- $root := index . "root" -}}
{{- $component := index . "component" -}}
{{- printf "%s.%s.svc.cluster.local" (include "event-booking.componentFullname" (dict "root" $root "component" $component)) (include "event-booking.namespace" $root) -}}
{{- end -}}
