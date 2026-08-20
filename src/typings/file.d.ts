declare namespace File {

	interface Info extends Common.InfoBase {
		src: string
		userId: number
		fileName: string
		method: number
		ext: string
		type?: string // icon/wallpaper/other
		path?: string
	}


}