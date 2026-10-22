{{- define "martian-connector.fullname" -}}
{{- printf "%s" .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "martian-connector.labels" -}}
app.kubernetes.io/name: martian-connector
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{- define "martian-connector.selector" -}}
app.kubernetes.io/name: martian-connector
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "martian-connector.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "martian-connector.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "martian-connector.secretName" -}}
{{- default (include "martian-connector.fullname" .) .Values.existingSecret -}}
{{- end -}}
