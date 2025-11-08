"use client"

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Search } from 'lucide-react';
import { useUser, useAuth } from '@clerk/nextjs';

const PYTHON_API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

interface OnboardingData {
  name: string;
  age_bracket: string;
  gender: string;
  country: string;
  tracking_interests: string[];
  wearable_devices: string[];
}

// List of all 195 countries
const countries = [
  'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Antigua and Barbuda', 'Argentina', 'Armenia', 'Australia', 'Austria',
  'Azerbaijan', 'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin', 'Bhutan',
  'Bolivia', 'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei', 'Bulgaria', 'Burkina Faso', 'Burundi', 'Cabo Verde', 'Cambodia',
  'Cameroon', 'Canada', 'Central African Republic', 'Chad', 'Chile', 'China', 'Colombia', 'Comoros', 'Congo', 'Costa Rica',
  'Croatia', 'Cuba', 'Cyprus', 'Czech Republic', 'Democratic Republic of the Congo', 'Denmark', 'Djibouti', 'Dominica', 'Dominican Republic', 'Ecuador',
  'Egypt', 'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia', 'Eswatini', 'Ethiopia', 'Fiji', 'Finland', 'France',
  'Gabon', 'Gambia', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Grenada', 'Guatemala', 'Guinea', 'Guinea-Bissau',
  'Guyana', 'Haiti', 'Honduras', 'Hungary', 'Iceland', 'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland',
  'Israel', 'Italy', 'Ivory Coast', 'Jamaica', 'Japan', 'Jordan', 'Kazakhstan', 'Kenya', 'Kiribati', 'Kuwait',
  'Kyrgyzstan', 'Laos', 'Latvia', 'Lebanon', 'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg',
  'Madagascar', 'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta', 'Marshall Islands', 'Mauritania', 'Mauritius', 'Mexico',
  'Micronesia', 'Moldova', 'Monaco', 'Mongolia', 'Montenegro', 'Morocco', 'Mozambique', 'Myanmar', 'Namibia', 'Nauru',
  'Nepal', 'Netherlands', 'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'North Korea', 'North Macedonia', 'Norway', 'Oman',
  'Pakistan', 'Palau', 'Palestine', 'Panama', 'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal',
  'Qatar', 'Romania', 'Russia', 'Rwanda', 'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Vincent and the Grenadines', 'Samoa', 'San Marino', 'Sao Tome and Principe',
  'Saudi Arabia', 'Senegal', 'Serbia', 'Seychelles', 'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia', 'Solomon Islands', 'Somalia',
  'South Africa', 'South Korea', 'South Sudan', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname', 'Sweden', 'Switzerland', 'Syria',
  'Taiwan', 'Tajikistan', 'Tanzania', 'Thailand', 'Timor-Leste', 'Togo', 'Tonga', 'Trinidad and Tobago', 'Tunisia', 'Turkey',
  'Turkmenistan', 'Tuvalu', 'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States', 'Uruguay', 'Uzbekistan', 'Vanuatu',
  'Vatican City', 'Venezuela', 'Vietnam', 'Yemen', 'Zambia', 'Zimbabwe'
];

export default function OnboardingPage() {
  const router = useRouter();
  const { user } = useUser();
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<OnboardingData>({
    name: '',
    age_bracket: '',
    gender: '',
    country: '',
    tracking_interests: [],
    wearable_devices: []
  });

  // Dropdown states
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [countrySearch, setCountrySearch] = useState('');

  // Close dropdown when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.dropdown-container')) {
        setOpenDropdown(null);
      }
    };

    if (openDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [openDropdown]);

  const ageBrackets = ['12-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'];
  const genderOptions = ['Male', 'Female'];
  const trackingInterests = ['Productivity', 'Education', 'Fitness & Health', 'Experiments', 'Other'];
  const wearableDevices = ['Screen Time (phone/computer)', 'Apple Watch', 'Oura Ring', 'Whoop', 'Garmin', 'Fitbit', 'None'];

  const filteredCountries = countries.filter(country => 
    country.toLowerCase().includes(countrySearch.toLowerCase())
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || loading) return; // Prevent double submission

    setLoading(true);
    try {
      console.log('🔄 Submitting onboarding data:', formData);
      
      // Get auth token from Clerk
      const token = await getToken();
      if (!token) {
        console.error('❌ No auth token found');
        throw new Error('Authentication required');
      }
      
      // Send onboarding data to Python backend
      const response = await fetch(`${PYTHON_API_BASE}/api/user/onboarding`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to save onboarding data');
      }

      const userData = await response.json();
      console.log('✅ Onboarding completed successfully:', userData);
      
      // Use replace instead of push to avoid adding to history
      // Use window.location for a hard redirect to avoid React re-renders
      window.location.href = '/dashboard';
    } catch (error) {
      console.error('❌ Error submitting onboarding:', error);
      alert(`Error saving onboarding data: ${error instanceof Error ? error.message : String(error)}`);
      setLoading(false);
    }
  };

  const isFormValid = formData.name && formData.age_bracket && formData.gender && formData.country && formData.tracking_interests.length > 0 && formData.wearable_devices.length > 0;

  const handleDropdownSelect = (field: keyof OnboardingData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setOpenDropdown(null);
  };

  const handleTrackingInterestToggle = (interest: string) => {
    setFormData(prev => ({
      ...prev,
      tracking_interests: prev.tracking_interests.includes(interest)
        ? prev.tracking_interests.filter(item => item !== interest)
        : [...prev.tracking_interests, interest]
    }));
  };

  const handleWearableDeviceToggle = (device: string) => {
    setFormData(prev => ({
      ...prev,
      wearable_devices: prev.wearable_devices.includes(device)
        ? prev.wearable_devices.filter(item => item !== device)
        : [...prev.wearable_devices, device]
    }));
  };

  const toggleDropdown = (dropdownName: string) => {
    setOpenDropdown(openDropdown === dropdownName ? null : dropdownName);
  };

  return (
    <div className="h-screen bg-white flex flex-col">
      {/* Fixed Header with Logo and Drag Region */}
      <div 
        data-tauri-drag-region 
        className="fixed top-0 left-0 w-full bg-white border-b border-gray-200 z-50 px-6 py-4"
      >
        <img 
          src="/images/ritual.svg" 
          alt="Ritual Logo" 
          className="h-6 w-auto"
        />
      </div>

      {/* Main content container */}
      <div className="flex-1 overflow-y-auto">
        <div className="min-h-screen flex items-center justify-center px-6 py-8">
          <div className="w-full max-w-md mt-16">
          <div className="text-center mb-10">
            <h1 className="text-2xl font-semibold text-gray-900 mb-2">
              Welcome to Ritual
            </h1>
            <p className="text-sm text-gray-500">
              Let's personalize your experience
            </p>
          </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-2">
              Name
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Enter your name"
              className="w-full px-3 py-2.5 text-sm border border-gray-300 rounded-none focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all"
            />
          </div>

          {/* Age */}
          <div className="relative dropdown-container">
            <label className="block text-sm font-medium text-gray-900 mb-2">
              Age
            </label>
            <button
              type="button"
              onClick={() => toggleDropdown('age')}
              className="w-full px-3 py-2.5 text-sm border border-gray-300 rounded-none text-left flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all hover:border-gray-400"
            >
              <span className={formData.age_bracket ? 'text-gray-900' : 'text-gray-400'}>
                {formData.age_bracket || 'Select age range'}
              </span>
              <ChevronDown className="w-4 h-4 text-gray-400" />
            </button>
            {openDropdown === 'age' && (
              <div 
                className="absolute z-[100] w-full mt-2 bg-white border border-gray-300 rounded-none shadow-xl max-h-[200px] overflow-y-auto overscroll-contain"
                onWheel={(e) => e.stopPropagation()}
              >
                {ageBrackets.map((age) => (
                  <button
                    key={age}
                    type="button"
                    onClick={() => handleDropdownSelect('age_bracket', age)}
                    className="w-full px-3 py-2.5 text-sm text-left hover:bg-gray-50 transition-colors"
                  >
                    {age}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Gender */}
          <div className="relative dropdown-container">
            <label className="block text-sm font-medium text-gray-900 mb-2">
              Gender
            </label>
            <button
              type="button"
              onClick={() => toggleDropdown('gender')}
              className="w-full px-3 py-2.5 text-sm border border-gray-300 rounded-none text-left flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all hover:border-gray-400"
            >
              <span className={formData.gender ? 'text-gray-900' : 'text-gray-400'}>
                {formData.gender || 'Select gender'}
              </span>
              <ChevronDown className="w-4 h-4 text-gray-400" />
            </button>
            {openDropdown === 'gender' && (
              <div 
                className="absolute z-[100] w-full mt-2 bg-white border border-gray-300 rounded-none shadow-xl max-h-[200px] overflow-y-auto overscroll-contain"
                onWheel={(e) => e.stopPropagation()}
              >
                {genderOptions.map((gender) => (
                  <button
                    key={gender}
                    type="button"
                    onClick={() => handleDropdownSelect('gender', gender)}
                    className="w-full px-3 py-2.5 text-sm text-left hover:bg-gray-50 transition-colors"
                  >
                    {gender}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Country */}
          <div className="relative dropdown-container">
            <label className="block text-sm font-medium text-gray-900 mb-2">
              Country
            </label>
            <button
              type="button"
              onClick={() => toggleDropdown('country')}
              className="w-full px-3 py-2.5 text-sm border border-gray-300 rounded-none text-left flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all hover:border-gray-400"
            >
              <span className={formData.country ? 'text-gray-900' : 'text-gray-400'}>
                {formData.country || 'Select country'}
              </span>
              <ChevronDown className="w-4 h-4 text-gray-400" />
            </button>
            {openDropdown === 'country' && (
              <div className="absolute z-[100] w-full mt-2 bg-white border border-gray-300 rounded-none shadow-xl">
                <div className="p-2 border-b border-gray-200 sticky top-0 bg-white">
                  <input
                    type="text"
                    value={countrySearch}
                    onChange={(e) => setCountrySearch(e.target.value)}
                    placeholder="Search countries..."
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-none focus:outline-none focus:ring-2 focus:ring-gray-900"
                    autoComplete="off"
                  />
                </div>
                <div 
                  className="overflow-y-auto overscroll-contain"
                  style={{ maxHeight: '294px' }}
                  onWheel={(e) => e.stopPropagation()}
                >
                  {filteredCountries.map((country) => (
                    <button
                      key={country}
                      type="button"
                      onClick={() => {
                        handleDropdownSelect('country', country);
                        setCountrySearch('');
                      }}
                      className="w-full px-3 py-2.5 text-sm text-left hover:bg-gray-50 transition-colors"
                    >
                      {country}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Tracking Interests */}
          <div className="relative dropdown-container">
            <label className="block text-sm font-medium text-gray-900 mb-2">
              What are you interested in tracking?
            </label>
            <button
              type="button"
              onClick={() => toggleDropdown('tracking')}
              className="w-full px-3 py-2.5 text-sm border border-gray-300 rounded-none text-left flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all hover:border-gray-400"
            >
              <span className={formData.tracking_interests.length > 0 ? 'text-gray-900' : 'text-gray-400'}>
                {formData.tracking_interests.length > 0 
                  ? `${formData.tracking_interests.length} selected` 
                  : 'Select interests'
                }
              </span>
              <ChevronDown className="w-4 h-4 text-gray-400" />
            </button>
            {openDropdown === 'tracking' && (
              <div 
                className="absolute z-[100] w-full mt-2 bg-white border border-gray-300 rounded-none shadow-xl max-h-[200px] overflow-y-auto overscroll-contain"
                onWheel={(e) => e.stopPropagation()}
              >
                {trackingInterests.map((interest) => (
                  <label
                    key={interest}
                    className="w-full px-3 py-2.5 text-left flex items-center space-x-2 hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={formData.tracking_interests.includes(interest)}
                      onChange={() => handleTrackingInterestToggle(interest)}
                      className="cursor-pointer"
                      style={{ 
                        width: '16px',
                        height: '16px',
                        appearance: 'none',
                        WebkitAppearance: 'none',
                        MozAppearance: 'none',
                        border: '1px solid #D1D5DB',
                        borderRadius: '0',
                        backgroundColor: formData.tracking_interests.includes(interest) ? '#111827' : 'white',
                        backgroundImage: formData.tracking_interests.includes(interest) 
                          ? 'url("data:image/svg+xml,%3csvg viewBox=\'0 0 16 16\' fill=\'white\' xmlns=\'http://www.w3.org/2000/svg\'%3e%3cpath d=\'M12.207 4.793a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0l-2-2a1 1 0 011.414-1.414L6.5 9.086l4.293-4.293a1 1 0 011.414 0z\'/%3e%3c/svg%3e")'
                          : 'none',
                        backgroundSize: '100% 100%',
                        backgroundPosition: 'center',
                        backgroundRepeat: 'no-repeat',
                        outline: 'none'
                      }}
                    />
                    <span className="text-sm">{interest}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Devices */}
          <div className="relative dropdown-container">
            <label className="block text-sm font-medium text-gray-900 mb-2">
              Which devices do you use for self-tracking?
            </label>
            <button
              type="button"
              onClick={() => toggleDropdown('devices')}
              className="w-full px-3 py-2.5 text-sm border border-gray-300 rounded-none text-left flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all hover:border-gray-400"
            >
              <span className={formData.wearable_devices.length > 0 ? 'text-gray-900' : 'text-gray-400'}>
                {formData.wearable_devices.length > 0 
                  ? `${formData.wearable_devices.length} selected` 
                  : 'Select devices'
                }
              </span>
              <ChevronDown className="w-4 h-4 text-gray-400" />
            </button>
            {openDropdown === 'devices' && (
              <div 
                className="absolute z-[100] w-full mt-2 bg-white border border-gray-300 rounded-none shadow-xl overflow-y-auto overscroll-contain"
                style={{ maxHeight: '210px' }}
                onWheel={(e) => e.stopPropagation()}
              >
                {wearableDevices.map((device) => (
                  <label
                    key={device}
                    className="w-full px-3 py-2.5 text-left flex items-center space-x-2 hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={formData.wearable_devices.includes(device)}
                      onChange={() => handleWearableDeviceToggle(device)}
                      className="cursor-pointer"
                      style={{ 
                        width: '16px',
                        height: '16px',
                        appearance: 'none',
                        WebkitAppearance: 'none',
                        MozAppearance: 'none',
                        border: '1px solid #D1D5DB',
                        borderRadius: '0',
                        backgroundColor: formData.wearable_devices.includes(device) ? '#111827' : 'white',
                        backgroundImage: formData.wearable_devices.includes(device) 
                          ? 'url("data:image/svg+xml,%3csvg viewBox=\'0 0 16 16\' fill=\'white\' xmlns=\'http://www.w3.org/2000/svg\'%3e%3cpath d=\'M12.207 4.793a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0l-2-2a1 1 0 011.414-1.414L6.5 9.086l4.293-4.293a1 1 0 011.414 0z\'/%3e%3c/svg%3e")'
                          : 'none',
                        backgroundSize: '100% 100%',
                        backgroundPosition: 'center',
                        backgroundRepeat: 'no-repeat',
                        outline: 'none'
                      }}
                    />
                    <span className="text-sm">{device}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={!isFormValid || loading}
            className="w-full bg-gray-900 text-white py-3 px-4 text-sm font-medium rounded-none hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed disabled:text-gray-500 transition-all mt-8"
          >
            {loading ? 'Saving...' : 'Continue to Dashboard'}
          </button>
        </form>
          </div>
        </div>
      </div>
    </div>
  );
}
