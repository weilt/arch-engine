<template>
  <div class="user-card">
    <span>{{ formatted }}</span>
  </div>
</template>

<script setup lang="ts">
import { formatDate } from "./utils.ts";

const props = defineProps<{ name: string }>();
const formatted = formatDate(props.name);
</script>
