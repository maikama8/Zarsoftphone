import { useState, useEffect } from 'react'
import { useStore } from '../store'
import type { AudioDevice } from '../types'

export default function Settings() {
  const settings = useStore((state) => state.settings)
  const updateSettings = useStore((state) => state.updateSettings)
  
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([])
  const [localSettings, setLocalSettings] = useState(settings)

  useEffect(() => {
    // Get audio devices
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      const audioInputs = devices
        .filter((d) => d.kind === 'audioinput')
        .map((d) => ({ deviceId: d.deviceId, label: d.label || 'Microphone', kind: 'audioinput' as const }))
      
      const audioOutputs = devices
        .filter((d) => d.kind === 'audiooutput')
        .map((d) => ({ deviceId: d.deviceId, label: d.label || 'Speaker', kind: 'audiooutput' as const }))
      
      setAudioDevices([...audioInputs, ...audioOutputs])
    })
  }, [])

  const handleSave = async () => {
    await window.electronAPI.db.updateSettings(localSettings)
    updateSettings(localSettings)
    alert('Settings saved')
  }

  const inputDevices = audioDevices.filter((d) => d.kind === 'audioinput')
  const outputDevices = audioDevices.filter((d) => d.kind === 'audiooutput')

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-3xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">Settings</h1>

        {/* General Settings */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">General</h2>
          
          <div className="space-y-4">
            <label className="flex items-center justify-between">
              <span>Launch at startup</span>
              <input
                type="checkbox"
                checked={localSettings.general.launchAtStartup}
                onChange={(e) => setLocalSettings({
                  ...localSettings,
                  general: { ...localSettings.general, launchAtStartup: e.target.checked }
                })}
                className="w-5 h-5"
              />
            </label>

            <label className="flex items-center justify-between">
              <span>Minimize to tray</span>
              <input
                type="checkbox"
                checked={localSettings.general.minimizeToTray}
                onChange={(e) => setLocalSettings({
                  ...localSettings,
                  general: { ...localSettings.general, minimizeToTray: e.target.checked }
                })}
                className="w-5 h-5"
              />
            </label>

            <label className="flex items-center justify-between">
              <span>Auto answer calls</span>
              <input
                type="checkbox"
                checked={localSettings.general.autoAnswer}
                onChange={(e) => setLocalSettings({
                  ...localSettings,
                  general: { ...localSettings.general, autoAnswer: e.target.checked }
                })}
                className="w-5 h-5"
              />
            </label>

            <label className="flex items-center justify-between">
              <span>Start hidden</span>
              <input
                type="checkbox"
                checked={localSettings.general.startHidden}
                onChange={(e) => setLocalSettings({
                  ...localSettings,
                  general: { ...localSettings.general, startHidden: e.target.checked }
                })}
                className="w-5 h-5"
              />
            </label>
          </div>
        </div>

        {/* Audio Settings */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Audio</h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Microphone</label>
              <select
                value={localSettings.audio.inputDeviceId || ''}
                onChange={(e) => setLocalSettings({
                  ...localSettings,
                  audio: { ...localSettings.audio, inputDeviceId: e.target.value }
                })}
                className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-primary-600"
              >
                <option value="">Default</option>
                {inputDevices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Speaker</label>
              <select
                value={localSettings.audio.outputDeviceId || ''}
                onChange={(e) => setLocalSettings({
                  ...localSettings,
                  audio: { ...localSettings.audio, outputDeviceId: e.target.value }
                })}
                className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-primary-600"
              >
                <option value="">Default</option>
                {outputDevices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Ringtone Volume: {localSettings.audio.ringtoneVolume}%
              </label>
              <input
                type="range"
                min="0"
                max="100"
                value={localSettings.audio.ringtoneVolume}
                onChange={(e) => setLocalSettings({
                  ...localSettings,
                  audio: { ...localSettings.audio, ringtoneVolume: parseInt(e.target.value) }
                })}
                className="w-full"
              />
            </div>
          </div>
        </div>

        {/* Notification Settings */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Notifications</h2>
          
          <div className="space-y-4">
            <label className="flex items-center justify-between">
              <span>Enable notifications</span>
              <input
                type="checkbox"
                checked={localSettings.notifications.enabled}
                onChange={(e) => setLocalSettings({
                  ...localSettings,
                  notifications: { ...localSettings.notifications, enabled: e.target.checked }
                })}
                className="w-5 h-5"
              />
            </label>

            <label className="flex items-center justify-between">
              <span>Show incoming call notifications</span>
              <input
                type="checkbox"
                checked={localSettings.notifications.showIncomingCalls}
                onChange={(e) => setLocalSettings({
                  ...localSettings,
                  notifications: { ...localSettings.notifications, showIncomingCalls: e.target.checked }
                })}
                className="w-5 h-5"
              />
            </label>
          </div>
        </div>

        {/* Theme Settings */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Appearance</h2>
          
          <div>
            <label className="block text-sm font-medium mb-2">Theme</label>
            <select
              value={localSettings.theme}
              onChange={(e) => setLocalSettings({
                ...localSettings,
                theme: e.target.value as 'dark' | 'light'
              })}
              className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-primary-600"
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </div>
        </div>

        {/* Save Button */}
        <button
          onClick={handleSave}
          className="w-full bg-primary-600 hover:bg-primary-700 text-white py-3 rounded-lg transition-colors"
        >
          Save Settings
        </button>
      </div>
    </div>
  )
}
