<script setup lang="ts">
import DefaultTheme from "vitepress/theme";
import HeaderLinks from "./components/HeaderLinks.vue";
import DocFooter from "./components/DocFooter.vue";

const { Layout } = DefaultTheme;
</script>

<template>
  <Layout>
    <template #nav-bar-content-after>
      <HeaderLinks />
    </template>
    <template #doc-after>
      <DocFooter />
    </template>
  </Layout>
</template>
