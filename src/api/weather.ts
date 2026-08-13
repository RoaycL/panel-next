import { get } from '@/utils/request'

export interface WeatherResponse {
  location: {
    name: string
    admin1?: string
    country?: string
    latitude: number
    longitude: number
    timezone?: string
  }
  current: {
    time: string
    temperature: number
    apparentTemperature: number
    relativeHumidity: number
    weatherCode: number
    windSpeed: number
    isDay: boolean
    temperatureUnit: string
    windSpeedUnit: string
  }
  units: 'metric' | 'imperial'
  fetchedAt: string
  cached: boolean
  stale: boolean
}

export function getWeather(city: string, units: 'metric' | 'imperial', signal?: AbortSignal) {
  return get<WeatherResponse>({
    url: '/v1/widgets/weather',
    data: { city, units },
    signal,
    silentNetworkError: true,
  })
}
