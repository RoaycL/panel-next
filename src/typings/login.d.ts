declare namespace Login{

    interface LoginReqest{
        username:string 
        password:string
        vcode?:string
    }

	interface LoginResponse extends User.Info{
		token :string
	}

    interface DeviceSessionRefreshResponse {
        accessToken:string
        refreshToken:string
        accessExpiresAt:string
        refreshExpiresAt:string
    }

    interface DeviceSessionLoginResponse extends DeviceSessionRefreshResponse {
        sessionId:string
        user:User.Info
    }

    interface ResetPasswordByVCodeReqest extends System.Register.SendRegisterVcodeRquest{
    }

}
