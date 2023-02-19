dev = ENV['RACK_ENV'] == 'development'
require 'rack/unreloader'

Unreloader = Rack::Unreloader.new(:reload=>dev){BedarssApp}
Unreloader.require './app.rb'

run(dev ? Unreloader : BedarssApp)
