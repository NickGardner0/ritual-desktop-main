"use client"

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

interface OnboardingData {
  name: string;
  age_bracket: string;
  gender: string;
  country: string;
  tracking_interests: string[];
  wearable_devices: string;
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
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<OnboardingData>({
    name: '',
    age_bracket: '',
    gender: '',
    country: '',
    tracking_interests: [],
    wearable_devices: ''
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
    if (!user) return;

    setLoading(true);
    try {
      console.log('🔄 Saving onboarding data:', formData);
      
      // Update the user's profile with onboarding data
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: formData.name,
          age_bracket: formData.age_bracket,
          gender: formData.gender,
          country: formData.country,
          tracking_interests: formData.tracking_interests,
          wearable_devices: [formData.wearable_devices],
          onboarding_completed: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id);

      if (error) {
        console.error('❌ Supabase error:', error);
        throw error;
      }

      console.log('✅ Profile updated successfully');
      
      // Redirect to dashboard
      router.push('/dashboard');
    } catch (error) {
      console.error('❌ Error saving onboarding data:', error);
    } finally {
      setLoading(false);
    }
  };

  const isFormValid = formData.name && formData.age_bracket && formData.gender && formData.country && formData.tracking_interests.length > 0 && formData.wearable_devices;

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

  const toggleDropdown = (dropdownName: string) => {
    setOpenDropdown(openDropdown === dropdownName ? null : dropdownName);
  };

  return (
    <div className="h-screen bg-white overflow-hidden flex flex-col">
      {/* Fixed Header with Logo and Drag Region */}
      <div 
        data-tauri-drag-region 
        className="fixed top-0 left-0 w-full bg-white z-50 px-6 py-4"
      >
        <img 
          src="/images/ritual.svg" 
          alt="Ritual Logo" 
          className="h-8 w-auto"
        />
      </div>

      {/* Main content container */}
      <div className="flex-1 flex items-center justify-center px-6 py-2 mt-14 overflow-hidden">
        <div className="w-full max-w-sm">
          <div className="text-center mb-6">
            <h1 className="text-lg font-semibold text-gray-900 mb-1" style={{ fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif' }}>
              Setup your profile
            </h1>
            <p className="text-xs text-gray-400" style={{ fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif' }}>
              Add your information to personalize<br />your experience in Ritual.
            </p>
          </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1" style={{ fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif' }}>
              Name
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Enter your name"
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-none focus:outline-none focus:ring-1 focus:ring-black focus:border-black"
              style={{ fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif' }}
            />
          </div>

          {/* Age */}
          <div className="relative dropdown-container">
            <label className="block text-xs font-medium text-gray-700 mb-1" style={{ fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif' }}>
              How old are you?
            </label>
            <button
              type="button"
              onClick={() => toggleDropdown('age')}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-none text-left flex items-center justify-between focus:outline-none focus:ring-1 focus:ring-black focus:border-transparent"
              style={{ fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif' }}
            >
              <span className={formData.age_bracket ? 'text-gray-900 text-sm' : 'text-gray-500 text-sm'}>
                {formData.age_bracket || 'Select age range'}
              </span>
              <ChevronDown className="w-3 h-3 text-gray-400" />
            </button>
            {openDropdown === 'age' && (
              <div className="absolute z-40 w-full mt-1 bg-white border border-gray-300 rounded-none shadow-lg max-h-32 overflow-y-auto">
                {ageBrackets.map((age) => (
                  <button
                    key={age}
                    type="button"
                    onClick={() => handleDropdownSelect('age_bracket', age)}
                    className="w-full px-2 py-1 text-sm text-left hover:bg-gray-50"
                    style={{ fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif' }}
                  >
                    {age}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Gender */}
          <div className="relative dropdown-container">
            <label className="block text-xs font-medium text-gray-700 mb-1" style={{ fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif' }}>
              Gender
            </label>
            <button
              type="button"
              onClick={() => toggleDropdown('gender')}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-none text-left flex items-center justify-between focus:outline-none focus:ring-1 focus:ring-black focus:border-transparent"
              style={{ fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif' }}
            >
              <span className={formData.gender ? 'text-gray-900 text-sm' : 'text-gray-500 text-sm'}>
                {formData.gender || 'Select gender'}
              </span>
              <ChevronDown className="w-3 h-3 text-gray-400" />
            </button>
            {openDropdown === 'gender' && (
              <div className="absolute z-40 w-full mt-1 bg-white border border-gray-300 rounded-none shadow-lg max-h-32 overflow-y-auto">
                {genderOptions.map((gender) => (
                  <button
                    key={gender}
                    type="button"
                    onClick={() => handleDropdownSelect('gender', gender)}
                    className="w-full px-2 py-1 text-sm text-left hover:bg-gray-50"
                    style={{ fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif' }}
                  >
                    {gender}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Country */}
          <div className="relative dropdown-container">
            <label className="block text-xs font-medium text-gray-700 mb-1" style={{ fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif' }}>
              Country
            </label>
            <button
              type="button"
              onClick={() => toggleDropdown('country')}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-none text-left flex items-center justify-between focus:outline-none focus:ring-1 focus:ring-black focus:border-transparent"
              style={{ fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif' }}
            >
              <span className={formData.country ? 'text-gray-900 text-sm' : 'text-gray-500 text-sm'}>
                {formData.country || 'Select country'}
              </span>
              <ChevronDown className="w-3 h-3 text-gray-400" />
            </button>
            {openDropdown === 'country' && (
              <div className="absolute z-40 w-full mt-1 bg-white border border-gray-300 rounded-none shadow-lg">
                <div className="p-1 border-b border-gray-200">
                  <input
                    type="text"
                    value={countrySearch}
                    onChange={(e) => setCountrySearch(e.target.value)}
                    placeholder="Search countries..."
                    className="w-full px-2 py-1 text-sm border border-gray-300 rounded-none focus:outline-none focus:ring-1 focus:ring-black focus:border-black"
                    style={{ fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif' }}
                  />
                </div>
                <div className="max-h-32 overflow-y-auto">
                  {filteredCountries.map((country) => (
                    <button
                      key={country}
                      type="button"
                      onClick={() => {
                        handleDropdownSelect('country', country);
                        setCountrySearch('');
                      }}
                      className="w-full px-2 py-1 text-sm text-left hover:bg-gray-50"
                      style={{ fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif' }}
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
            <label className="block text-xs font-medium text-gray-700 mb-1" style={{ fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif' }}>
              What are you interested in tracking?
            </label>
            <button
              type="button"
              onClick={() => toggleDropdown('tracking')}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-none text-left flex items-center justify-between focus:outline-none focus:ring-1 focus:ring-black focus:border-transparent"
              style={{ fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif' }}
            >
              <span className={formData.tracking_interests.length > 0 ? 'text-gray-900 text-sm' : 'text-gray-500 text-sm'}>
                {formData.tracking_interests.length > 0 
                  ? `${formData.tracking_interests.length} selected` 
                  : 'Select tracking interests'
                }
              </span>
              <ChevronDown className="w-3 h-3 text-gray-400" />
            </button>
            {openDropdown === 'tracking' && (
              <div className="absolute z-40 w-full mt-1 bg-white border border-gray-300 rounded-none shadow-lg max-h-32 overflow-y-auto">
                {trackingInterests.map((interest) => (
                  <label
                    key={interest}
                    className="w-full px-2 py-1 text-left flex items-center space-x-2 hover:bg-gray-50"
                    style={{ fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif' }}
                  >
                    <input
                      type="checkbox"
                      checked={formData.tracking_interests.includes(interest)}
                      onChange={() => handleTrackingInterestToggle(interest)}
                      className="w-3 h-3 accent-black bg-white border-gray-300 rounded-none focus:ring-1 focus:ring-black"
                    />
                    <span className="text-xs">{interest}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Devices */}
          <div className="relative dropdown-container">
            <label className="block text-xs font-medium text-gray-700 mb-1" style={{ fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif' }}>
              Which devices do you currently use for self-tracking?
            </label>
            <button
              type="button"
              onClick={() => toggleDropdown('devices')}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-none text-left flex items-center justify-between focus:outline-none focus:ring-1 focus:ring-black focus:border-transparent"
              style={{ fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif' }}
            >
              <span className={formData.wearable_devices ? 'text-gray-900 text-sm' : 'text-gray-500 text-sm'}>
                {formData.wearable_devices 
                  ? `${formData.wearable_devices}` 
                  : 'Select device'
                }
              </span>
              <ChevronDown className="w-3 h-3 text-gray-400" />
            </button>
            {openDropdown === 'devices' && (
              <div className="absolute z-40 w-full mt-1 bg-white border border-gray-300 rounded-none shadow-lg max-h-32 overflow-y-auto">
                {wearableDevices.map((device) => (
                  <button
                    key={device}
                    type="button"
                    onClick={() => handleDropdownSelect('wearable_devices', device)}
                    className="w-full px-2 py-1 text-sm text-left hover:bg-gray-50"
                    style={{ fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif' }}
                  >
                    {device}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={!isFormValid}
            className="w-full bg-black text-white py-1.5 px-3 text-sm rounded-none hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed mt-4"
            style={{ fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif' }}
          >
            Enter Dashboard
          </button>
        </form>
        </div>
      </div>
    </div>
  );
}
