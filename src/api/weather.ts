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
    // Added for the detail view; older cached responses may not carry them.
    windDirection?: number
    pressure?: number
    visibility?: number
    visibilityUnit?: string
    uvIndex?: number
    precipitation?: number
    precipitationUnit?: string
    dewPoint?: number
  }
  hourly?: Array<{
    time: string
    temperature: number
    weatherCode: number
    isDay: boolean
    precipitationProbability: number
  }>
  daily?: Array<{
    date: string
    weatherCode: number
    temperatureMax: number
    temperatureMin: number
    sunrise?: string
    sunset?: string
    uvIndexMax?: number
    precipitationProbability?: number
  }>
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
