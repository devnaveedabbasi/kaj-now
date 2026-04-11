import User from "../../models/User.model";


export const getAllProviders = async (req, res) => {
    try {
        const providers = await User.find({ role: 'provider' }).select('-password');
        res.status(200).json({ success: true, data: providers });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
export const getAllUsers= async (req, res) => {
    try {
        const users = await User.find().select('-password');
        res.status(200).json({ success: true, data: users });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
