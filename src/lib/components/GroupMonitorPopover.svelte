<script lang="ts">
  import { browser } from "$app/environment";
  import type { Snippet } from "svelte";
  import { page } from "$app/state";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import { buttonVariants } from "$lib/components/ui/button/index.js";
  import { requestMonitorBar } from "$lib/client/monitor-bar-client";
  import type { MonitorBarResponse } from "$lib/server/api-server/monitor-bar/get";
  import MonitorBar from "$lib/components/MonitorBar.svelte";
  import { t } from "$lib/stores/i18n";

  interface Props {
    tags: string[];
    days: number;
    endOfDayTodayAtTz: number;
    children: Snippet;
  }

  // Wolfsblvt fork: group members expand inline below the group instead of in a drawer, and member groups
  // expand the same way. Members load only once the group is first opened.
  let { tags, days, endOfDayTodayAtTz, children }: Props = $props();
  const regionId = $props.id();
  let isOpen = $state(false);
  let monitorBarPromiseByTag = $state<Partial<Record<string, Promise<MonitorBarResponse>>>>({});

  function toggle() {
    isOpen = !isOpen;
    if (isOpen && browser && Object.keys(monitorBarPromiseByTag).length === 0) {
      monitorBarPromiseByTag = Object.fromEntries(
        tags.map((tag) => [tag, requestMonitorBar(tag, days, endOfDayTodayAtTz)])
      );
    }
  }

  const childTagsOf = (tag: string): string[] => page.data.monitorGroupMembersByTag?.[tag] ?? [];
</script>

<div class="kener-group w-full" data-state={isOpen ? "open" : "closed"}>
  <button
    type="button"
    class={buttonVariants({
      variant: "ghost",
      size: "sm",
      class: "rounded-btn bg-secondary kener-group-toggle w-full text-xs"
    })}
    aria-expanded={isOpen}
    aria-controls={regionId}
    onclick={toggle}
  >
    {@render children()}
    <ChevronDown class="size-4 transition-transform duration-200 motion-reduce:transition-none {isOpen ? 'rotate-180' : ''}" />
  </button>
  <div id={regionId} class="kener-group-members mt-2 flex flex-col" hidden={!isOpen}>
    {#if isOpen}
      {#if tags.length === 0}
        <div class="text-muted-foreground p-4 text-sm">{$t("No monitors available.")}</div>
      {:else}
        {#each tags as tag, i (tag)}
          <div class="kener-group-member {i < tags.length - 1 ? 'border-b' : ''} py-2 pb-4">
            {#if monitorBarPromiseByTag[tag]}
              {#await monitorBarPromiseByTag[tag]}
                <MonitorBar {tag} />
              {:then monitorBarData}
                <MonitorBar
                  {tag}
                  prefetchedData={monitorBarData}
                  groupChildTags={childTagsOf(tag)}
                  {days}
                  {endOfDayTodayAtTz}
                />
              {:catch err}
                <MonitorBar {tag} prefetchedError={err instanceof Error ? err.message : "Unknown error"} />
              {/await}
            {:else}
              <MonitorBar {tag} />
            {/if}
          </div>
        {/each}
      {/if}
    {/if}
  </div>
</div>
