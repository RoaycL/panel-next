<script setup lang="ts">
import StatusPage from '../StatusPage.vue'
</script>

<template>
  <StatusPage code="500" :title="$t('statusPage.serverErrorTitle')" :description="$t('statusPage.serverErrorDescription')" retry />
</template>
