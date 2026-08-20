import { get, post } from '@/utils/request'

export interface DockerStatus {
  available: boolean
  version?: any
}

export interface DockerContainer {
  id: string
  name: string
  image: string
  status: string
  state: string
  ports: Array<{
    privatePort: number
    publicPort?: number
    type: string
    ip?: string
  }>
}

export function getDockerStatus<T>() {
  return get<T>({ url: '/docker/status' })
}

export function getDockerList<T>() {
  return get<T>({ url: '/docker/getList' })
}

export function startContainer<T>(containerId: string) {
  return post<T>({ url: '/docker/start', data: { id: containerId } })
}

export function stopContainer<T>(containerId: string) {
  return post<T>({ url: '/docker/stop', data: { id: containerId } })
}

export function restartContainer<T>(containerId: string) {
  return post<T>({ url: '/docker/restart', data: { id: containerId } })
}
