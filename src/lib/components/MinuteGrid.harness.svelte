<!-- Test-only: MinuteGrid needs the Tooltip.Provider that app layouts supply. -->
<script lang="ts">
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import MinuteGrid from "./MinuteGrid.svelte";

  let { minutes, uptime }: { minutes: { timestamp: number; status: string }[]; uptime: string } = $props();
</script>

<Tooltip.Provider>
  <MinuteGrid {minutes} {uptime} />
</Tooltip.Provider>
