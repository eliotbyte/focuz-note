export function formatRelativeShort(input: string | Date, nowDate: Date = new Date()): string {
	const date = typeof input === 'string' ? new Date(input) : input
	const diffMs = Math.max(0, nowDate.getTime() - date.getTime())

	const minuteMs = 60 * 1000
	const hourMs = 60 * minuteMs
	const dayMs = 24 * hourMs
	const weekMs = 7 * dayMs

	if (diffMs < minuteMs) return 'just now'

	const minutes = Math.floor(diffMs / minuteMs)
	if (minutes < 60) return `${minutes}m`

	const hours = Math.floor(diffMs / hourMs)
	if (hours < 24) return `${hours}h`

	const days = Math.floor(diffMs / dayMs)
	if (days < 7) return `${days}d`

	const weeks = Math.floor(diffMs / weekMs)
	if (weeks < 5) return `${weeks}w`

	// Months: approximate by 30-day months, as per short social-style formatting
	const months = Math.floor(days / 30)
	if (months >= 1 && months < 12) return `${months}mo`

	const years = Math.floor(days / 365)
	return `${years}y`
}

export function formatExactDateTime(input: string | Date): string {
	const d = typeof input === 'string' ? new Date(input) : input
	const pad = (n: number) => n.toString().padStart(2, '0')
	const DD = pad(d.getDate())
	const MM = pad(d.getMonth() + 1)
	const YYYY = d.getFullYear().toString()
	const HH = pad(d.getHours())
	const mm = pad(d.getMinutes())
	const SS = pad(d.getSeconds())
	return `${DD}-${MM}-${YYYY} ${HH}:${mm}:${SS}`
} 

// --- Duration helpers ---

export function parseDurationToMs(input: string): number {
	const s = (input || '').trim().toLowerCase()
	if (!s) return NaN

	// RFC3339 time-of-day fallback like 1970-01-01T01:02:03.250Z
	if (s.includes('t') && s.includes(':')) {
		const m = s.match(/t(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/)
		if (m) {
			const h = Number(m[1] || 0)
			const mi = Number(m[2] || 0)
			const se = Number(m[3] || 0)
			const ms = Number(m[4] || 0)
			return ((h * 60 + mi) * 60 + se) * 1000 + ms
		}
	}

	// HH:MM:SS(.ms) or MM:SS(.ms) or SS(.ms)
	if (/^\d{1,2}(:\d{2}){1,2}(\.\d{1,3})?$/.test(s)) {
		const [main, frac] = s.split('.')
		const parts = main.split(':').map(Number)
		let h = 0, m = 0, sec = 0
		if (parts.length === 3) [h, m, sec] = parts
		else if (parts.length === 2) [m, sec] = parts
		else if (parts.length === 1) sec = parts[0]
		const ms = frac ? Number(frac.padEnd(3, '0').slice(0, 3)) : 0
		return ((h * 60 + m) * 60 + sec) * 1000 + ms
	}

	// Token scanner: e.g. 1h 2m 3s 250ms (order-insensitive)
	let total = 0
	const re = /(\d+(?:\.\d+)?)(\s*(?:milliseconds|millisecond|ms|seconds|second|secs|sec|s|minutes|minute|mins|min|m|hours|hour|hrs|hr|h))/g
	let match: RegExpExecArray | null
	while ((match = re.exec(s)) !== null) {
		const num = Number(match[1])
		const unit = match[2].replace(/\s+/g, '')
		if (!Number.isFinite(num)) continue
		switch (unit) {
			case 'h': case 'hr': case 'hrs': case 'hour': case 'hours': total += num * 60 * 60 * 1000; break
			case 'm': case 'min': case 'mins': case 'minute': case 'minutes': total += num * 60 * 1000; break
			case 's': case 'sec': case 'secs': case 'second': case 'seconds': total += num * 1000; break
			case 'ms': case 'millisecond': case 'milliseconds': total += num; break
			default: break
		}
	}
	if (total > 0) return Math.round(total)

	// Plain number -> milliseconds
	const n = Number(s)
	if (Number.isFinite(n)) return Math.round(n)
	return NaN
}

export function formatDurationCeil(msInput: number): string {
	const ms = Math.max(0, Math.floor(msInput || 0))
	const sec = 1000
	const min = 60 * sec
	const hour = 60 * min
	if (ms >= hour) return `${Math.ceil(ms / hour)}h`
	if (ms >= min) return `${Math.ceil(ms / min)}m`
	// For sub-minute durations show seconds, rounding up; enforce 5s minimum for any positive value
	const seconds = Math.ceil(ms / sec)
	if (seconds <= 0) return '0s'
	return `${Math.max(5, seconds)}s`
}

export function formatDurationShort(msInput: number): string {
	const ms = Math.max(0, Math.floor(msInput || 0))
	const sec = 1000
	const min = 60 * sec
	const hour = 60 * min

	if (ms >= hour) {
		const h = Math.floor(ms / hour)
		const m = Math.floor((ms % hour) / min)
		return m > 0 ? `${h}h ${m}m` : `${h}h`
	}
	if (ms >= min) {
		const m = Math.ceil(ms / min)
		return `${m}m`
	}
	const seconds = Math.ceil(ms / sec)
	if (seconds <= 0) return '0s'
	return `${Math.max(5, seconds)}s`
}
/** "just now", "5m ago", "3d ago". */
export function formatAgo(input: string | Date, nowDate: Date = new Date()): string {
	const r = formatRelativeShort(input, nowDate)
	return r === 'just now' ? r : `${r} ago`
}
