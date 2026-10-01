package system

type ApiSystem struct {
	About                 About
	LoginApi              LoginApi
	UserApi               UserApi
	ClientCapabilitiesApi ClientCapabilitiesApi
	SyncBootstrapApi      SyncBootstrapApi
	SyncChangesApi        SyncChangesApi
	SyncWaitApi           SyncWaitApi
	FileApi               FileApi
	NoticeApi             NoticeApi
	ModuleConfigApi       ModuleConfigApi
	MonitorApi            MonitorApi
	BackupApi             BackupApi
	SiteSettingApi        SiteSettingApi
	PublicFileApi         PublicFileApi
	OpenAPIApi            OpenAPIApi
}
