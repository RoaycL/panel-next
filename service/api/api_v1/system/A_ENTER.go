package system

type ApiSystem struct {
	About                 About
	LoginApi              LoginApi
	UserApi               UserApi
	UserSessionApi        UserSessionApi
	ClientCapabilitiesApi ClientCapabilitiesApi
	SyncBootstrapApi      SyncBootstrapApi
	SyncChangesApi        SyncChangesApi
	FileApi               FileApi
	NoticeApi             NoticeApi
	ModuleConfigApi       ModuleConfigApi
	MonitorApi            MonitorApi
	BackupApi             BackupApi
	SiteSettingApi        SiteSettingApi
	PublicFileApi         PublicFileApi
	DockerApi             DockerApi
	OpenAPIApi            OpenAPIApi
}
