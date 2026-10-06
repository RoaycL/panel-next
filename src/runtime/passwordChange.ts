import { ref } from 'vue'

// Set when the server answers 1010: the signed-in account still uses the
// factory password and may only change it or sign out.
export const passwordChangeRequired = ref(false)
