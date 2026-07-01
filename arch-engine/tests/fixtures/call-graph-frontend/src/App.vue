<template>
  <div class="app">
    <UserCard :user="user" />
  </div>
</template>

<script setup lang="ts">
import UserCard from "./UserCard.vue";

defineProps<{ user: { name: string } }>();
</script>
