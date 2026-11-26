-- Register the new catalogue items while preserving any existing balances.
with new_counts as (
  select '{"a660-turf-adhesive":0,"oilcap-25l":0,"outpace-flowable-5l":0,"viroaxe-5l":0,"starbug-5l":0,"cypermethrin-1l":0,"hth-clear4weeks-12kg":0,"black-sanitiser":0}'::jsonb as defaults
)
update stock_private.state as shared
set counts = new_counts.defaults || shared.counts,
    version = shared.version + 1
from new_counts
where shared.singleton = true
  and not (shared.counts ?& array(select jsonb_object_keys(new_counts.defaults)));
