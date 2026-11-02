// Save confirmed choices in order. A failed choice must not leak into later saves.
export function createSettingsAutosave({ settings, save, onChange, onError }) {
  let saved = { ...settings }, work = null;
  const pending = [];
  const current = () => Object.assign({}, saved, ...pending);
  const emit = status => onChange({ settings: current(), status });
  const drain = async () => {
    while (pending.length) {
      const next = { ...saved, ...pending[0] };
      let error;
      try { await save(next); saved = next; }
      catch (failure) { error = failure; }
      pending.shift();
      emit(pending.length ? 'saving' : error ? 'error' : 'saved');
      if (error) onError(error);
    }
  };
  return {
    update(patch) {
      const value = current();
      if (Object.keys(patch).every(key => patch[key] === value[key])) return;
      pending.push({ ...patch });
      emit('saving');
      if (!work) work = drain().finally(() => { work = null; });
    },
    // Finish writes before the parent token is revoked on Back/Home.
    flush: () => work || Promise.resolve(),
  };
}
