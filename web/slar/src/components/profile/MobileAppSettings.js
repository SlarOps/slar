'use client';

import { useState, useEffect, useCallback } from 'react';
import apiClient from '../../lib/api';
import { toast } from 'react-hot-toast';
import QRCode from 'qrcode';

export default function MobileAppSettings({ userId }) {
  const [qrData, setQrData] = useState(null);
  const [qrImage, setQrImage] = useState(null);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingDevices, setLoadingDevices] = useState(true);
  const [timeRemaining, setTimeRemaining] = useState(0);

  // Load connected devices
  useEffect(() => {
    loadDevices();
  }, []);

  // Countdown timer for QR expiration
  useEffect(() => {
    if (!qrData) return;

    const interval = setInterval(() => {
      const remaining = Math.max(0, qrData.expires_at - Math.floor(Date.now() / 1000));
      setTimeRemaining(remaining);

      if (remaining === 0) {
        setQrData(null);
        setQrImage(null);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [qrData]);

  const loadDevices = async () => {
    try {
      setLoadingDevices(true);
      const result = await apiClient.getMobileDevices();
      setDevices(result.devices || []);
    } catch (error) {
      console.error('Failed to load devices:', error);
      // Don't show error toast - table might not exist yet
    } finally {
      setLoadingDevices(false);
    }
  };

  const generateQR = async () => {
    try {
      setLoading(true);
      const data = await apiClient.generateMobileConnectQR();
      setQrData(data);

      // Generate QR code image
      const qrString = JSON.stringify(data);
      const qrImageUrl = await QRCode.toDataURL(qrString, {
        width: 256,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff'
        }
      });
      setQrImage(qrImageUrl);

      toast.success('QR code generated');
    } catch (error) {
      console.error('Failed to generate QR:', error);
      toast.error('Failed to generate QR code');
    } finally {
      setLoading(false);
    }
  };

  const disconnectDevice = async (deviceId) => {
    try {
      await apiClient.disconnectMobileDevice(deviceId);
      toast.success('Device disconnected');
      loadDevices();
    } catch (error) {
      console.error('Failed to disconnect device:', error);
      toast.error('Failed to disconnect device');
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleString();
  };

  return (
    <div className="space-y-6">
      {/* QR Code Section */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-medium text-gray-900">Connect Mobile App</h3>
            <p className="text-sm text-gray-600 mt-1">
              Scan this QR code with the SLAR mobile app to receive push notifications.
            </p>
          </div>
        </div>

        {!qrImage ? (
          <div className="text-center py-8">
            <div className="w-64 h-64 mx-auto bg-gray-100 rounded-lg flex items-center justify-center mb-4">
              <div className="text-center">
                <svg className="w-16 h-16 mx-auto text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                </svg>
                <p className="text-gray-500 text-sm">QR code will appear here</p>
              </div>
            </div>
            <button
              onClick={generateQR}
              disabled={loading}
              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Generating...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                  </svg>
                  Generate QR Code
                </>
              )}
            </button>
          </div>
        ) : (
          <div className="text-center py-4">
            <div className="inline-block p-4 bg-white rounded-lg shadow-lg border border-gray-200 mb-4">
              <img src={qrImage} alt="QR Code" className="w-64 h-64" />
            </div>
            <div className="flex items-center justify-center space-x-2 mb-4">
              <svg className={`w-5 h-5 ${timeRemaining < 60 ? 'text-red-500' : 'text-gray-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className={`text-sm font-medium ${timeRemaining < 60 ? 'text-red-600' : 'text-gray-600'}`}>
                Expires in {formatTime(timeRemaining)}
              </span>
            </div>
            <button
              onClick={generateQR}
              disabled={loading}
              className="inline-flex items-center px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Regenerate QR Code
            </button>
          </div>
        )}

        {/* Instructions */}
        <div className="mt-6 p-4 bg-blue-50 rounded-lg">
          <h4 className="text-sm font-medium text-blue-900 mb-2">How to connect:</h4>
          <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside">
            <li>Download the SLAR app from App Store or Google Play</li>
            <li>Open the app and tap "Connect Instance"</li>
            <li>Scan this QR code with your phone's camera</li>
            <li>Allow notifications when prompted</li>
          </ol>
        </div>
      </div>

      {/* Connected Devices Section */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Connected Devices</h3>

        {loadingDevices ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-2 text-sm text-gray-500">Loading devices...</p>
          </div>
        ) : devices.length === 0 ? (
          <div className="text-center py-8 bg-gray-50 rounded-lg">
            <svg className="w-12 h-12 mx-auto text-gray-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            <p className="text-gray-600 font-medium">No connected devices</p>
            <p className="text-sm text-gray-500 mt-1">Scan the QR code above to connect your mobile device</p>
          </div>
        ) : (
          <div className="space-y-3">
            {devices.map((device) => {
              let deviceInfo = {};
              try {
                deviceInfo = JSON.parse(device.device_info || '{}');
              } catch (e) {}

              return (
                <div key={device.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      deviceInfo.platform === 'ios' ? 'bg-gray-800' : 'bg-green-600'
                    }`}>
                      {deviceInfo.platform === 'ios' ? (
                        <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
                        </svg>
                      ) : (
                        <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M17.523 15.3414c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.5511 0 .9993.4482.9993.9993s-.4482.9997-.9993.9997m-11.046 0c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.5511 0 .9993.4482.9993.9993s-.4482.9997-.9993.9997m11.4045-6.02l1.9973-3.4592a.416.416 0 00-.1521-.5676.416.416 0 00-.5765.1521l-2.0223 3.503C15.5902 8.2439 13.8533 7.8508 12 7.8508s-3.5902.3931-5.1278 1.0989L4.85 5.4467a.4164.4164 0 00-.5765-.1521.4146.4146 0 00-.1521.5765l1.9973 3.4592C2.6889 11.1867.3432 14.6589 0 18.761h24c-.3432-4.1021-2.6889-7.5743-6.1185-9.4396"/>
                        </svg>
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">
                        {deviceInfo.device_name || 'Unknown Device'}
                      </p>
                      <p className="text-sm text-gray-500">
                        {deviceInfo.platform === 'ios' ? 'iOS' : 'Android'} • Last active: {formatDate(device.last_active_at)}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => disconnectDevice(device.id)}
                    className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    Disconnect
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
