<script setup lang="ts">
import { withBase } from "vitepress";
import ThemeMenu from "./ThemeMenu.vue";
</script>

<template>
  <a class="header-link header-link--plain" :href="withBase('/support')">Support</a>
  <ThemeMenu />
</template>
