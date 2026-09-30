<script setup lang="ts">
import StatusPage from '../StatusPage.vue'
</script>

<template>
  <StatusPage code="404" :title="$t('statusPage.notFoundTitle')" :description="$t('statusPage.notFoundDescription')" />
</template>
