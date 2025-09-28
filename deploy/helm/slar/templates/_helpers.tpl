{{/*
Expand the name of the chart.
*/}}
{{- define "slar.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "slar.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "slar.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "slar.labels" -}}
helm.sh/chart: {{ include "slar.chart" . }}
{{ include "slar.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "slar.selectorLabels" -}}
app.kubernetes.io/name: {{ include "slar.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "slar.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "slar.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}


{{/*
Component-scoped fullname: <release>-<chart|override>-<component>
*/}}
{{- define "slar.componentFullname" -}}
{{- $root := .root -}}
{{- $comp := .name -}}
{{- printf "%s-%s" (include "slar.fullname" $root) $comp | trunc 63 | trimSuffix "-" -}}
{{- end }}

{{/*
Component selector labels
*/}}
{{- define "slar.componentSelectorLabels" -}}
app.kubernetes.io/name: {{ include "slar.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .name }}
{{- end }}

{{/*
Component common labels
*/}}
{{- define "slar.componentLabels" -}}
helm.sh/chart: {{ include "slar.chart" .root }}
{{ include "slar.componentSelectorLabels" . }}
{{- if .root.Chart.AppVersion }}
app.kubernetes.io/version: {{ .root.Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .root.Release.Service }}
{{- end }}
