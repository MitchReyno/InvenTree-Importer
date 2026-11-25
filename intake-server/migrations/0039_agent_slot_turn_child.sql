-- What a held slot's turn may have started outside its worker, recorded before it is started, so a
-- restarted worker can confirm it gone before releasing the slot. `none` means nothing has been;
-- `vm` keeps the exact command sent to the guest, which its removal probe needs. A slot claimed
-- before this migration has no record and cannot be confirmed.
ALTER TABLE agent_slot
  ADD COLUMN turn bigint CHECK (turn > 0),
  ADD COLUMN turn_child text CHECK (turn_child IN ('none','host','vm')),
  ADD COLUMN vm_command text,
  ADD CONSTRAINT agent_slot_turn_child_held
    CHECK (attempt_id IS NOT NULL OR (turn IS NULL AND turn_child IS NULL AND vm_command IS NULL)),
  ADD CONSTRAINT agent_slot_turn_child_recorded CHECK ((turn IS NULL) = (turn_child IS NULL)),
  ADD CONSTRAINT agent_slot_vm_command CHECK ((vm_command IS NOT NULL) = (turn_child IS NOT DISTINCT FROM 'vm'));
