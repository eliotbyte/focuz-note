// Seeds a fresh user with realistic data through the public API.
// Usage: node e2e/seed.mjs <apiBase> [username]
export async function seed(api, username = `demo${Date.now().toString(36)}`, imageWebp) {
  const password = 'Password123'
  const j = async (path, init = {}, token) => {
    const res = await fetch(api + path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) },
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`${path} -> ${res.status} ${JSON.stringify(body)}`)
    return body
  }
  await j('/register', { method: 'POST', body: JSON.stringify({ username, password }) })
  const token = (await j('/login', { method: 'POST', body: JSON.stringify({ username, password }) })).data.token
  const spaces = (await j('/spaces', { method: 'GET' }, token)).data?.data ?? []
  const spaceId = spaces[0]?.id ?? (await j('/spaces', { method: 'POST', body: JSON.stringify({ name: 'My Space' }) }, token)).data.id
  const now = Date.now()
  const iso = (minAgo) => new Date(now - minAgo * 60000).toISOString()
  const texts = [
    ['Ревью архитектуры синхронизации: вынести очередь заданий в отдельный модуль, добавить экспоненциальный backoff.', ['work', 'sync']],
    ['Купить: молоко, хлеб, кофе в зёрнах, батарейки AA.', ['home', 'shopping']],
    ['Идея: фильтры в сайдбаре должны запоминать раскрытые ветки между перезагрузками.', ['ideas', 'focuz']],
    ['Прочитать «Designing Data-Intensive Applications», глава 5 — репликация.', ['reading']],
    ['Созвон с командой в четверг 15:00. Подготовить демо офлайн-режима.', ['work', 'meetings']],
    ['Тренировка: 5 км, темп 5:40. Чувствую себя хорошо.', ['health', 'running']],
    ['Заметка про PWA: service worker кеширует картинки CacheFirst — проверить инвалидацию.', ['focuz', 'pwa']],
    ['Список подарков на НГ: настолка, термокружка, книга по фотографии.', ['home', 'ideas']],
  ]
  const notes = texts.map(([text, tags], i) => ({ id: null, clientId: crypto.randomUUID(), space_id: spaceId, text, tags, created_at: iso(600 - i * 60), modified_at: iso(600 - i * 60), date: iso(600 - i * 60) }))
  const push1 = await j('/sync', { method: 'POST', body: JSON.stringify({ notes, filters: [], tags: [], charts: [] }) }, token)
  const ids = push1.data.mappings.filter(m => m.resource === 'note').map(m => m.serverId)
  const replies = [
    { id: null, clientId: crypto.randomUUID(), space_id: spaceId, text: 'Ответ: backoff начинать с 2с, потолок 60с.', tags: ['work'], parent_id: ids[0], created_at: iso(30), modified_at: iso(30), date: iso(30) },
    { id: null, clientId: crypto.randomUUID(), space_id: spaceId, text: 'И не забыть про таймаут запросов.', tags: [], parent_id: ids[0], created_at: iso(20), modified_at: iso(20), date: iso(20) },
  ]
  await j('/sync', { method: 'POST', body: JSON.stringify({ notes: replies, filters: [], tags: [], charts: [] }) }, token)

  // Filter hierarchy: 3 roots, nested 3 levels, enough items to overflow the sidebar.
  const tree = [
    ['Работа', ['Проекты', ['Focuz', 'Синхронизация', 'UI']], ['Встречи'], ['Ревью']],
    ['Дом', ['Покупки'], ['Ремонт', ['Кухня', 'Ванная']], ['Финансы']],
    ['Личное', ['Здоровье', ['Бег', 'Сон']], ['Чтение', ['Технические', 'Художественные']], ['Идеи'], ['Путешествия'], ['Фото']],
    ['Архив'], ['Входящие'],
  ]
  let order = 0
  async function createFilter(name, parentId) {
    order += 10
    const f = { id: null, clientId: crypto.randomUUID(), space_id: spaceId, parent_id: parentId ?? null, name, params: { includeTags: [], _order: order }, created_at: iso(1000), modified_at: iso(1000) }
    const r = await j('/sync', { method: 'POST', body: JSON.stringify({ notes: [], filters: [f], tags: [], charts: [] }) }, token)
    return r.data.mappings.find(m => m.resource === 'filter').serverId
  }
  async function walk(node, parentId) {
    const [name, ...children] = node
    const id = await createFilter(name, parentId)
    for (const ch of children) {
      if (Array.isArray(ch)) await walk(ch, id)
      else await createFilter(ch, id)
    }
  }
  for (const root of tree) await walk(root, null)

  if (imageWebp) {
    const form = new FormData()
    form.append('file', new Blob([imageWebp], { type: 'image/webp' }), 'photo.webp')
    form.append('note_id', String(ids[6]))
    form.append('client_id', crypto.randomUUID())
    const res = await fetch(api + '/upload', { method: 'POST', body: form, headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error('upload failed ' + res.status + ' ' + await res.text())
  }
  return { username, password, token, spaceId, noteIds: ids }
}
