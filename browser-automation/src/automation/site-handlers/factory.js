// browser-automation/src/automation/site-handlers/factory.js

const { GenericHandler } = require('./generic');
const { IndeedHandler } = require('./indeed');
const { LinkedInHandler } = require('./linkedin');
const { RemoteOKHandler } = require('./remoteok');
const { GreenhouseHandler } = require('./greenhouse');
const { LeverHandler } = require('./lever');

class SiteHandlerFactory {
    static getHandler(url, jobSource) {
        const hostname = new URL(url).hostname.toLowerCase();

        // Match by hostname or job source
        if (hostname.includes('indeed.com') || jobSource === 'indeed') {
            console.log('Using Indeed handler');
            return new IndeedHandler();
        }

        if (hostname.includes('linkedin.com') || jobSource === 'linkedin') {
            console.log('Using LinkedIn handler');
            return new LinkedInHandler();
        }

        if (hostname.includes('remoteok.com') || hostname.includes('remoteok.io') || jobSource === 'remoteok') {
            console.log('Using RemoteOK handler');
            return new RemoteOKHandler();
        }

        if (hostname.includes('greenhouse.io') || jobSource === 'greenhouse') {
            console.log('Using Greenhouse handler');
            return new GreenhouseHandler();
        }

        if (hostname.includes('lever.co') || jobSource === 'lever') {
            console.log('Using Lever handler');
            return new LeverHandler();
        }

        console.log('Using generic handler');
        return new GenericHandler();
    }
}

module.exports = { SiteHandlerFactory };