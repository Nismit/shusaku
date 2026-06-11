/**
 * Shader Loader
 */
const path = new URL(import.meta.url).searchParams.get('path') || '';
const res = await fetch(path);
const text = await res.text();
export default text;