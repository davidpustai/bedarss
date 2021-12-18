source 'https://rubygems.org'
gem 'sinatra', '~> 2.1.0'
gem 'nokogiri', '~> 1.12.5'

group :production do
  gem "passenger", ">= 5.3.2", require: "phusion_passenger/rack_handler"
end

group :development do
  gem 'sinatra-contrib', '~> 2.1.0'
end
